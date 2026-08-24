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
npm run dev        # watch build
npm run build      # development build
npm test           # compact Node regression suite
npm run validate   # policy check + tests + release build + package verification
npm run release    # production build + release/ + ZIP only
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

### Bind panel actions to the host tab

The embedded iframe must not infer ownership from the globally active browser tab. `docked-panel.js` supplies host conversation context and relays iframe commands through the service worker, where `sender.tab` identifies the authoritative ChatGPT tab. Keep stale-conversation validation on this bridge.

### Preserve tree interaction state

Canonical refreshes recreate arrays and Maps even when topology is unchanged. UI state must therefore use semantic topology identity, not JavaScript object identity. `getQATreeStructureKey()` is the shared structural signature for Graph and Tree views. Timeline recursion should use ancestry/cycle guards rather than arbitrary depth truncation.

### Preserve graph geometry

Revealing a collapsed single assistant response must not move existing graph nodes. Dagre lays out the base graph first; compact answer nodes are inserted afterward into reserved inter-rank space. Full-message details likewise render as an overlay instead of changing the fixed graph-card dimensions.

## Source layout

```text
src/
├── background/
│   ├── auth/                 # ChatGPT bearer-token capture
│   ├── database/             # conversations/nodes/edges IndexedDB stores
│   ├── messaging/            # runtime routing and host-tab relay
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

tests/
├── core.test.mjs             # pure graph/tree/stream/layout invariants
└── compat.test.mjs           # isolated ChatGPT experiment adapter
```

## Validation design

The repository intentionally keeps a small test surface instead of accumulating one script per bug. Tests use Node's built-in `node:test` runner and are grouped by architectural boundary:

- **core** — canonical graph model, current-node resolution, branch grouping, stream normalization, semantic tree identity, and stable layout;
- **compat** — the early edited-message experiment adapter.

Static/release contracts are separate from behavioral tests:

- `npm run check` enforces the English-only repository policy;
- `npm run verify:release` verifies the packaged extension contract;
- `npm run validate` is the one authoritative local/CI entry point.

When adding a regression, extend the existing boundary test unless a genuinely new runtime boundary appears. Avoid creating a new test file for each individual bug.

## Debugging

### Content integration

Open DevTools on a ChatGPT page. Enable debug logging from the extension popup when additional canonical-sync and navigation logs are needed.

### Service worker

Open `chrome://extensions`, find ChatGPT Graph Navigator, and inspect its service worker.

### Embedded React UI

The right dock contains an extension iframe. Select that execution context in DevTools to inspect React-side state and DOM. Host-context and command messages are exchanged with the dock parent, not with an arbitrary active tab.

## Common problems

### The graph becomes correct only after Refresh

Treat this as a canonical synchronization problem. Verify that the message observer emitted a change signal and that the backend conversation refetch completed. Do not repair it with DOM parent inference.

### Native `1/N` switching does not update the highlighted graph path

Check whether the mounted turn's message ID changed and whether the next backend snapshot returned the expected `current_node`. The graph should follow that value after normalization.

### A graph node cannot switch branches

Separate topology from actuation:

1. verify that nodes/edges contain the correct target path;
2. verify that `branch-navigator.js` can mount the divergence turn and operate ChatGPT's native version controls;
3. verify that the dock host command still targets the same conversation ID.

Do not modify graph topology to compensate for an actuator failure.

### An old message is absent from the DOM

This is normal in long conversations. ChatGPT virtualizes turns. Use the mounting/scrolling helpers instead of assuming every active-path node is present simultaneously.

### IndexedDB has no conversation yet

This can happen when the embedded panel initializes before the content script persists its first canonical snapshot. It is a normal cache miss; the panel should request a content refresh.

## Release workflow

GitHub Actions deliberately mirrors the repository entry point instead of restating individual checks:

1. `npm ci`
2. `npm run validate`
3. upload `release/` as the ready-to-load artifact

This keeps test/build policy versioned in ordinary repository code rather than hidden in CI YAML.

## References

- [Chrome Extensions](https://developer.chrome.com/docs/extensions/)
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [React Flow](https://reactflow.dev/)
- [Dagre](https://github.com/dagrejs/dagre)
