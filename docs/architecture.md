# Architecture

ChatGPT Graph Navigator is a Manifest V3 Chrome extension that adds a persistent conversation tree to ChatGPT. The architecture separates **canonical conversation state** from **DOM actuation** so frontend markup changes cannot silently corrupt graph topology.

## Runtime overview

```text
ChatGPT page
├── MAIN world, document_start
│   └── edited-message pagination compatibility adapter
│
├── isolated extension world
│   ├── content integration
│   │   ├── canonical conversation fetch
│   │   ├── mapping normalization
│   │   ├── DOM and route change signals
│   │   └── branch/navigation actuator
│   └── right-dock host
│       └── extension iframe: React graph/tree UI
│
└── MV3 service worker
    ├── runtime message routing
    ├── ChatGPT bearer-token capture
    └── IndexedDB persistence
        ├── conversations
        ├── nodes
        └── edges
```

## Canonical state

ChatGPT's conversation response provides two pieces of semantic state:

- `mapping` — node IDs and parent/child relationships for the complete conversation tree;
- `current_node` — the leaf currently selected by ChatGPT.

The extension treats both as authoritative. `mapping` defines topology and `current_node` defines the active branch path.

The raw mapping is normalized to user/assistant nodes. System and tool intermediary nodes are bypassed while preserving the nearest valid ancestry. Assistant stream fragments can also be collapsed into one graph node. When `current_node` points to a filtered intermediary or a stream fragment, `parser/current-node.js` resolves it to the normalized graph node that represents the same active branch.

## DOM boundary

The DOM is deliberately not a semantic data source.

### Change signals

`observers/message-observer.js` watches mounted turn IDs. A new message ID or a native edited-message version change emits only:

```js
{ id, role }
```

The content script then refetches the backend conversation snapshot. No DOM sibling, wrapper position, or `previousElementSibling` relationship is converted into a graph edge.

### UI actuation

DOM-dependent behavior is limited to operations that necessarily control ChatGPT's visible interface:

- locating a mounted message;
- scrolling virtualized history until a required turn is mounted;
- operating ChatGPT's native previous/next edited-message controls;
- verifying the resulting message ID.

This logic lives primarily in `utils/branch-navigator.js` and `utils/message-id-helper.js`.

## Embedded host bridge

The React iframe does not guess which browser tab owns it. The dock host already runs inside the correct ChatGPT tab, so it explicitly supplies the current conversation identity and relays refresh/navigation commands.

```text
React iframe
    ↓ postMessage
right-dock content script
    ↓ runtime message (sender.tab is authoritative)
service worker
    ↓ tabs.sendMessage to that same tab
content integration
```

The bridge validates both the iframe origin and the host ChatGPT URL. A command also carries the expected conversation ID; the service worker rejects it if the host tab has already navigated elsewhere. This removes active-tab polling and prevents cross-tab races.

## Edited-message compatibility adapter

Some ChatGPT frontend experiments replace in-place edited-message pagination with a modal/new-chat flow. `compat/edit-pagination-compat.js` runs in the page MAIN world at `document_start` and normalizes only the relevant frontend experiment fields before ChatGPT consumes them.

It is kept separate from the main content bundle so this invasive compatibility boundary remains small and testable.

## Route lifecycle

ChatGPT is an SPA. The content script starts a route observer even when the initial page is not a conversation. Entering `/c/<id>` activates canonical synchronization; leaving a conversation route tears down message observation and in-memory graph state.

A generation counter prevents an old asynchronous fetch from committing after the user has already switched conversations. The dock uses the same route-observer abstraction to update the iframe host context or remove the panel outside conversation routes.

## Canonical synchronization

### Initial conversation load

```text
conversation route
      ↓
load captured token
      ↓
GET /backend-api/conversation/{id}
      ↓
parse mapping → nodes + edges
      ↓
normalize assistant stream groups
      ↓
resolve current_node
      ↓
persist canonical snapshot
      ↓
DATA_READY → embedded UI
```

### Live update

```text
DOM message/version ID changes
      ↓
debounced change signal
      ↓
refetch canonical backend snapshot
      ↓
replace nodes + edges + currentNodeId
      ↓
persist and refresh UI
```

A user-message signal waits longer than an assistant completion so a short exchange often collapses into one backend refresh. Limited retries cover backend persistence lag.

## Persistence

IndexedDB version 6 stores only data the current product reads:

- `conversations` — title/timestamps, node/edge counts, and `currentNodeId`;
- `nodes` — normalized graph nodes;
- `edges` — normalized parent/child edges.

Earlier derived stores for rounds, branches, and raw backups are removed during the v6 upgrade. The React UI derives its QA tree directly from nodes and edges.

A canonical write stores nodes and edges before publishing the corresponding conversation metadata. A concurrent reader may briefly observe the previous complete snapshot, but it cannot observe a new `currentNodeId` paired with the previous graph payload.

A panel may initialize before the content script has written the first snapshot. `GET_CONVERSATION` therefore treats a missing record as a normal cache miss; the UI requests a canonical refresh instead of surfacing an extension error.

## Embedded UI

The right dock hosts `src/sidepanel/index.html` in an extension iframe. The React application provides:

- **Graph view** using React Flow;
- **Timeline tree** for compact branch browsing, search, and filtering.

A node click updates the panel selection optimistically and sends a host-bound navigation command. The next canonical snapshot reconciles that selection with ChatGPT's actual `current_node`. If actuation fails, the panel requests a canonical refresh immediately instead of leaving stale optimistic state behind.

The QA tree exposes a semantic structure key derived from ordered roots and parent/child relationships. Recreated Map/object instances from an unchanged canonical snapshot therefore do not look like a new tree. The timeline keeps manual expansion state across ordinary refreshes, resets it when the conversation changes, and uses ancestry guards rather than an arbitrary maximum-depth cutoff.

## Stable graph geometry

Single-answer assistant responses are collapsed by default. The visual layout is intentionally two-stage:

1. Dagre computes a base layout without hidden single-answer nodes.
2. When one is revealed, its compact node is inserted into reserved space between existing ranks.

Existing node coordinates therefore do not change during answer reveal/hide. Graph cards also keep fixed dimensions matching the Dagre constants; full-message text opens in a focusable, dismissible overlay rather than resizing a node.

## Dock and theme integration

`ui/docked-panel.js` owns behavior for the automatic right-hand dock, while `ui/docked-panel.css` owns its host-page presentation. The dock occupies page layout space, is resizable/collapsible, and forwards ChatGPT's effective foreground/background colors to the iframe. The panel uses one token-based stylesheet for its graph and timeline views.

## Validation architecture

The repository keeps validation intentionally small and explicit:

- `tests/core.test.mjs` — canonical graph model, branch grouping, stream normalization, semantic tree identity, and stable graph layout;
- `tests/compat.test.mjs` — the isolated edited-message compatibility adapter;
- `scripts/check-no-chinese.mjs` — repository language policy;
- `scripts/verify-release.mjs` — release-package contract.

Tests use Node's built-in test runner; no test-framework dependency is carried by the extension. `npm run validate` is the single authoritative entry point and runs policy checks, tests, the release build, and package verification. GitHub Actions invokes that command rather than duplicating test logic in workflow YAML.

## Compatibility boundaries

ChatGPT is a private and changing web application. Frontend coupling is intentionally concentrated in three small areas:

- the early experiment compatibility adapter;
- native branch-control discovery;
- virtualized-turn mounting/scrolling.

Conversation topology, active-branch state, persistence, and graph rendering do not depend on DOM adjacency.
