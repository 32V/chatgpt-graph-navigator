# Development Guide

This guide covers the current development workflow for ChatGPT Graph Navigator.

## Requirements

- Node.js 18 or newer
- npm
- Chrome or another Chromium-based browser
- A ChatGPT account

## Setup

```bash
git clone https://github.com/32V/chatgpt-graph-navigator.git
cd chatgpt-graph-navigator
npm ci
```

Start a watch build while developing:

```bash
npm run dev
```

Create a normal build:

```bash
npm run build
```

Create a production package:

```bash
npm run release
```

The release command writes a loadable extension to `release/` and also creates a ZIP archive at the repository root.

## Loading the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select either the project root after `npm run build`, or the `release/` directory after `npm run release`.
5. After rebuilding, press **Reload** on the extension card and refresh existing ChatGPT tabs.

The edited-message compatibility layer runs at `document_start`, so a page refresh is required whenever that bundle changes.

## Debugging

### Content script

Open DevTools on a ChatGPT conversation page. Content-script logs use the `ChatGPT Graph` logger and are easiest to inspect in the page console.

Debug logging can be enabled from the extension settings popup.

### Service worker

Open:

```text
chrome://extensions
```

Find ChatGPT Graph Navigator and open the **Service worker** inspector.

### Embedded graph UI

The right-hand graph panel is an extension iframe embedded in ChatGPT. In Chrome DevTools, use the execution-context selector to switch to the extension frame when inspecting React-side logs or DOM state.

## Important architecture constraints

Before changing topology or navigation code, read [architecture.md](architecture.md). The following rules are intentional and should be preserved.

### Do not infer canonical ancestry from DOM adjacency

ChatGPT virtualizes long conversations and changes its turn wrappers frequently. The canonical graph must come from the backend conversation `mapping`.

DOM observers may signal that data changed, but they should trigger a canonical refresh rather than creating parent/child edges themselves.

### Keep ChatGPT UI coupling small

DOM-dependent behavior belongs in narrow adapters, primarily:

- edited-message branch controls;
- virtualized-turn mounting;
- scrolling and focus behavior.

Graph construction, persistence, and branch-path computation should not depend on CSS utility classes or a particular ChatGPT wrapper hierarchy.

### Preserve stable graph layout

Revealing a collapsed single assistant response must not cause unrelated graph nodes to move. The base Dagre layout is intentionally computed without those inline response nodes; they are inserted afterward into reserved vertical space.

If you change this behavior, update `scripts/test-qa-tree-layout.mjs`.

## Source layout

```text
src/
├── background/
│   ├── auth/                 # Bearer-token capture
│   ├── database/             # IndexedDB persistence
│   ├── messaging/            # Runtime message routing
│   └── index.js              # MV3 service-worker entry point
│
├── content/
│   ├── api/                  # ChatGPT conversation API
│   ├── compat/               # document_start frontend compatibility patch
│   ├── observers/            # DOM/route change signals
│   ├── parser/               # Mapping normalization
│   ├── state/                # In-page canonical conversation state
│   ├── ui/                   # Dock host and ChatGPT-page UI
│   ├── utils/                # Branch navigation and DOM helpers
│   └── index.js              # Main content-script entry point
│
├── popup/                    # Settings popup
├── setup/                    # Manual token setup page
├── shared/                   # Shared constants and helpers
└── sidepanel/
    ├── components/           # Graph/timeline React components
    ├── hooks/                # UI data hooks
    ├── styles/               # Base sidepanel styles
    ├── utils/                # QA tree and layout utilities
    └── index.jsx             # React entry point
```

## Code style

Keep changes focused and avoid adding abstractions that are only used once. Prefer small, explicit adapters around unstable ChatGPT behavior.

Use descriptive camelCase for functions and variables, PascalCase for React components/classes, and uppercase snake case for true constants.

Comments should explain **why** a non-obvious constraint exists rather than narrating straightforward code.

Example:

```js
// ChatGPT virtualizes old turns, so a missing DOM node does not imply that the
// message belongs to another branch. Check the canonical path first.
if (currentPath.includes(messageId)) {
  await mountMessage(messageId);
}
```

## Regression checks

Run the same checks used by CI:

```bash
node scripts/check-no-chinese.mjs
node scripts/test-edit-pagination-compat.mjs
node scripts/test-qa-tree-layout.mjs
npm run release
```

### English-only source policy

The repository intentionally ships and maintains English only. `check-no-chinese.mjs` scans source files, documentation, HTML, CSS, JSON, and workflow files and fails when Han characters are introduced.

### Compatibility-layer test

`test-edit-pagination-compat.mjs` verifies the known ChatGPT experiment configurations that hide edited-message pagination and ensures the compatibility layer normalizes them to the in-place branch UI.

### Graph-layout test

`test-qa-tree-layout.mjs` verifies that expanding a single assistant response leaves existing node coordinates unchanged.

## Common development problems

### The graph is correct only after pressing Refresh

Treat this as a canonical synchronization problem. Do not patch DOM parent inference. Inspect whether the content script received a change signal and whether the backend mapping refresh completed.

### A graph node cannot switch ChatGPT branches

Separate the problem into two layers:

1. Does the canonical graph contain the correct target path?
2. Can the branch actuator find and operate ChatGPT's native edited-message controls?

If the first is correct, avoid changing graph topology code while debugging the second.

### Old messages cannot be found in the DOM

This is expected in long conversations because ChatGPT virtualizes turns. Use the graph depth and scrolling/mounting helpers rather than assuming every active-path message is mounted at once.

### The right dock looks stale after a UI change

Reload the extension and refresh the ChatGPT tab. The dock host CSS is injected by the content script, while the graph UI CSS is loaded inside an extension iframe; both contexts need the updated extension resources.

### IndexedDB says a conversation is missing

A panel can initialize before the content script has persisted the first canonical snapshot. This is an expected cache miss. The UI should request a content refresh instead of treating it as a fatal error.

## Release workflow

The GitHub Actions workflow builds an installable artifact on every branch push. The production process is:

1. `npm ci`
2. English-only source/documentation check
3. compatibility regression test
4. graph-layout regression test
5. `npm run release`
6. verify required files in `release/`
7. upload `release/` as a GitHub Actions artifact

For manual releases, run:

```bash
npm run release
```

## Useful references

- [Chrome Extensions documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- [IndexedDB on MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [React Flow](https://reactflow.dev/)
- [Dagre](https://github.com/dagrejs/dagre)
