# Architecture

ChatGPT Graph Navigator is a Manifest V3 Chrome extension that augments `chatgpt.com` with a persistent conversation graph. The design deliberately separates **semantic conversation state** from **DOM interaction** so that ChatGPT frontend changes do not corrupt the graph.

## Runtime overview

```text
┌──────────────────────────────────────────────────────────────┐
│ ChatGPT page                                                 │
│                                                              │
│  document_start MAIN world                                   │
│  └─ edit-pagination compatibility layer                      │
│                                                              │
│  isolated extension world                                    │
│  ├─ content script                                           │
│  │  ├─ canonical conversation fetch                          │
│  │  ├─ mapping parser                                        │
│  │  ├─ DOM observers used as change signals                  │
│  │  ├─ branch navigation actuator                            │
│  │  └─ docked panel host                                     │
│  │                                                           │
│  └─ iframe: React graph/timeline UI                          │
└──────────────────────┬───────────────────────────────────────┘
                       │ chrome.runtime messages
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ MV3 service worker                                           │
│  ├─ message router                                           │
│  ├─ bearer-token capture                                     │
│  ├─ IndexedDB persistence                                    │
│  └─ lightweight cache                                        │
└──────────────────────────────────────────────────────────────┘
```

## Core design rules

### 1. Backend mapping is the source of truth

ChatGPT exposes a conversation mapping with node IDs, parent/child relationships, and the active `current_node`. That mapping defines the semantic conversation tree.

The extension does **not** use DOM sibling order to construct canonical ancestry. ChatGPT virtualizes long conversations and changes wrapper structure frequently, so DOM adjacency is not reliable enough for graph semantics.

### 2. DOM observations are change signals, not topology

The content script observes message changes so it knows when the canonical snapshot may be stale. After a debounced change signal, it fetches the conversation mapping again and replaces the local graph state.

This avoids the historical failure mode where every new user message appeared as another root because `previousElementSibling` no longer represented the previous logical turn.

### 3. DOM interaction is isolated to UI actuation

Some operations still require the visible ChatGPT interface:

- switching an edited-message branch;
- mounting a virtualized turn by scrolling;
- scrolling a selected message into view.

These operations are implemented in the branch/navigation layer and verified against message IDs. They are not used to define the graph itself.

### 4. Compatibility patches run before ChatGPT bootstraps

Some ChatGPT frontend experiments hide the native edited-message pagination UI and replace it with a "continue in a new chat" flow. The extension restores the in-place branch selector in a small MAIN-world script injected at `document_start`.

Keeping this patch separate from the main content bundle minimizes its scope and makes failures easier to isolate.

## Main modules

### `src/content/`

The content script owns page integration.

#### `api/conversation.js`

Fetches the canonical conversation snapshot from ChatGPT's backend API with retry handling.

#### `parser/`

Normalizes ChatGPT mapping nodes into the extension's graph representation. Assistant stream normalization collapses transient thinking/final-answer variants according to the selected setting.

#### `observers/`

Watches the ChatGPT page for message and route changes. Message observers trigger canonical refreshes; route observers reload state when the conversation ID changes.

#### `utils/branch-navigator.js`

Navigates to arbitrary graph nodes. It:

1. computes the target path from canonical graph data;
2. identifies branch divergence points;
3. mounts the relevant turn when virtualization has removed it from the DOM;
4. uses ChatGPT's native previous/next branch controls;
5. verifies that the expected message ID became active.

#### `ui/docked-panel.js`

Hosts the right-side graph panel inside ChatGPT. The panel:

- opens automatically on conversation routes;
- occupies layout space rather than covering the chat;
- can be resized or collapsed;
- follows the active ChatGPT theme;
- embeds the React UI in an extension iframe.

#### `compat/edit-pagination-compat.js`

Runs in the page MAIN world at `document_start` and normalizes the ChatGPT frontend experiment that controls edited-message pagination.

### `src/background/`

The MV3 service worker handles persistence and cross-context messaging.

#### `messaging/message-handler.js`

Routes messages between the content script and UI. A missing IndexedDB conversation is treated as a normal cache miss so the UI can request a canonical refresh without generating an extension error.

#### `database/`

Stores conversations, nodes, edges, rounds, and branches in IndexedDB.

#### `auth/token-capture.js`

Captures the bearer token from ChatGPT requests so the content script can call the conversation endpoint without requiring repeated manual setup.

### `src/sidepanel/`

The same React application is embedded inside the in-page dock.

#### `components/ConversationGraph.jsx`

Renders the graph with React Flow. Main interactions:

- single click: navigate ChatGPT to a node;
- double click: focus the graph viewport on a node;
- canvas drag: pan;
- right drag: pan without the browser context menu;
- controls/minimap: zoom and overview.

#### `utils/qaTreeLayout.js`

Builds the visual QA graph and applies Dagre layout. Single-answer response expansion is intentionally handled **after** the base layout so revealing an assistant node does not move unrelated nodes.

#### `components/GitTreeView.jsx`

Provides the compact timeline/tree representation, search, filtering, and branch inspection.

## Data flow

### Initial load

```text
ChatGPT conversation route
        │
        ▼
content script extracts conversation ID
        │
        ▼
GET /backend-api/conversation/{id}
        │
        ▼
parse + normalize mapping
        │
        ├─ initialize in-page conversation state
        └─ send CONVERSATION_LOADED
                │
                ▼
          service worker / IndexedDB
                │
                ▼
             React UI
```

### Live update

```text
DOM observer detects a new/changed turn
        │
        ▼
debounced canonical sync
        │
        ▼
refetch backend mapping
        │
        ▼
replace graph snapshot
        │
        ▼
persist + notify UI
```

No canonical parent/child edge is created from DOM adjacency.

## Persistence model

The IndexedDB database contains separate stores for:

- `conversations`
- `nodes`
- `edges`
- `rounds`
- `branches`
- conversation backups

The UI can open before a conversation has been written to IndexedDB. In that case `GET_CONVERSATION` returns a cache miss, and the UI asks the content script for a fresh canonical snapshot.

## Graph layout stability

The graph has two layout layers:

1. **Base layout** — stable question nodes and explicit multi-answer branches are passed to Dagre.
2. **Inline single-answer expansion** — a hidden single assistant response is inserted into the reserved vertical gap after Dagre finishes.

Because the second step does not recompute Dagre positions, expanding or collapsing a single answer leaves every existing node at the same coordinates. A regression test enforces this invariant.

## Theme integration

The dock reads ChatGPT's effective foreground/background colors and forwards them to the embedded UI. The graph derives all surfaces, borders, muted text, controls, and selection states from those host colors. This keeps light/dark theme behavior aligned with ChatGPT instead of maintaining a separate palette.

## Build and verification

`build.js` bundles the runtime scripts and CSS with esbuild. `npm run release` builds production assets, assembles `release/`, and creates the ZIP package.

CI runs:

1. an English-only source/documentation check;
2. the edited-message compatibility regression test;
3. the stable graph-layout regression test;
4. the production build and package verification.

## Compatibility boundaries

ChatGPT is a private, evolving web application. The extension cannot eliminate all frontend coupling, but it intentionally limits that coupling to small adapters:

- the early experiment compatibility script;
- native branch-control discovery;
- virtualized-turn mounting and scrolling.

The conversation model, graph topology, and persistence layer remain independent of those details.
