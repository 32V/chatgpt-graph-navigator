# Development Guide

## Requirements

- Node.js 18+
- npm
- Chrome or another Chromium-based browser
- A ChatGPT account

## Setup

```bash
git clone https://github.com/32V/chatgpt-graph-navigator.git
cd chatgpt-graph-navigator
npm ci
```

Useful commands:

```bash
npm run dev       # watch build
npm run build     # development build
npm run release   # production build + release/ + ZIP
```

Load either the project root after `npm run build` or `release/` after `npm run release` from `chrome://extensions` with Developer mode enabled. Reload the extension and refresh existing ChatGPT tabs after rebuilding. The edited-message compatibility adapter runs at `document_start`, so a page refresh is required for changes to that bundle.

## Architecture constraints

Read [architecture.md](architecture.md) before changing topology or navigation behavior.

### `mapping` defines topology

Never derive canonical parent/child edges from DOM adjacency. ChatGPT virtualizes turns and changes wrapper markup frequently. DOM observations may trigger a canonical refetch, but graph ancestry must come from the backend conversation `mapping`.

### `current_node` defines the active branch

The backend `current_node` is the canonical selected leaf. If parser or assistant-stream normalization removes that raw node, resolve it to the corresponding normalized graph node instead of guessing the active path from mounted DOM turns.

### DOM coupling belongs in adapters

DOM-dependent code should be limited to:

- detecting turn/message-ID changes;
- discovering native edited-message controls;
- mounting virtualized turns;
- scrolling and focus behavior.

Graph construction, persistence, and selected-path computation should remain independent of CSS utility classes and sibling order.

### Preserve stable answer expansion

Revealing a collapsed single assistant response must not move existing graph nodes. Dagre lays out the base graph first; compact answer nodes are inserted afterward into reserved inter-rank space. Update `scripts/test-qa-tree-layout.mjs` if this behavior changes.

## Source layout

```text
src/
├── background/
│   ├── auth/                 # ChatGPT bearer-token capture
│   ├── database/             # conversations/nodes/edges IndexedDB stores
│   ├── messaging/            # runtime routing
│   └── index.js              # MV3 service worker
│
├── content/
│   ├── api/                  # ChatGPT conversation API
│   ├── compat/               # document_start frontend adapter
│   ├── observers/            # message-ID and SPA route signals
│   ├── parser/               # mapping, stream, and current-node normalization
│   ├── state/                # minimal in-page canonical state
│   ├── ui/                   # automatic right-dock host
│   ├── utils/                # branch navigation and DOM helpers
│   └── index.js              # content integration
│
├── popup/                    # settings popup
├── setup/                    # optional manual token setup
├── shared/                   # cross-context constants/helpers
└── sidepanel/                # embedded React graph/tree UI
```

## Regression checks

Run the same checks as CI:

```bash
node scripts/check-no-chinese.mjs
node scripts/test-edit-pagination-compat.mjs
node scripts/test-current-node.mjs
node scripts/test-qa-tree-layout.mjs
npm run release
```

The tests cover:

- the English-only repository policy;
- ChatGPT experiment normalization for in-place edited-message pagination;
- canonical `current_node` resolution and selected-path construction;
- graph-coordinate stability when revealing a single assistant response.

## Debugging

### Content integration

Open DevTools on a ChatGPT page. Enable debug logging from the extension popup when additional canonical-sync and navigation logs are needed.

### Service worker

Open `chrome://extensions`, find ChatGPT Graph Navigator, and inspect its service worker.

### Embedded React UI

The right dock contains an extension iframe. Select that execution context in DevTools to inspect React-side state and DOM.

## Common problems

### The graph becomes correct only after Refresh

Treat this as a canonical synchronization problem. Verify that the message observer emitted a change signal and that the backend conversation refetch completed. Do not repair it with DOM parent inference.

### Native `1/N` switching does not update the highlighted graph path

Check whether the mounted turn's message ID changed and whether the next backend snapshot returned the expected `current_node`. The graph should follow that value after normalization.

### A graph node cannot switch branches

Separate topology from actuation:

1. verify that nodes/edges contain the correct target path;
2. verify that `branch-navigator.js` can mount the divergence turn and operate ChatGPT's native version controls.

Do not modify graph topology to compensate for an actuator failure.

### An old message is absent from the DOM

This is normal in long conversations. ChatGPT virtualizes turns. Use the mounting/scrolling helpers instead of assuming every active-path node is present simultaneously.

### IndexedDB has no conversation yet

This can happen when the embedded panel initializes before the content script persists its first canonical snapshot. It is a normal cache miss; the panel should request a content refresh.

## Release workflow

GitHub Actions builds a ready-to-load artifact on every branch push:

1. `npm ci`
2. English-only check
3. pagination compatibility test
4. canonical current-node test
5. stable layout test
6. `npm run release`
7. package verification
8. artifact upload

## References

- [Chrome Extensions](https://developer.chrome.com/docs/extensions/)
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [React Flow](https://reactflow.dev/)
- [Dagre](https://github.com/dagrejs/dagre)
