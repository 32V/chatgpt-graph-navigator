<div align="center">
  <img src="docs/pic/icon256.png" alt="ChatGPT Graph Navigator" width="112" />

  <h1>ChatGPT Graph Navigator</h1>
  <p><strong>A native-feeling conversation tree for ChatGPT.</strong></p>
</div>

ChatGPT Graph Navigator turns branched ChatGPT conversations into an interactive graph and timeline directly inside `chatgpt.com`. It follows ChatGPT's light and dark themes and opens automatically as a collapsible, resizable right-hand dock.

The project is intentionally English-only.

## Highlights

- **Automatic docked panel** — opens on ChatGPT conversation routes, resizes with the page, and can collapse to a narrow rail.
- **Graph view** — inspect the full conversation topology, pan and zoom, and focus individual nodes.
- **Timeline tree** — browse the same conversation as a compact hierarchy with search and filtering.
- **Branch-aware navigation** — click a graph or tree node to switch ChatGPT to the corresponding message version and branch.
- **Native branch-state sync** — ChatGPT's backend `current_node` determines the active branch, including when you switch versions with ChatGPT's own `1/N` controls.
- **Restored in-place version navigation** — a small `document_start` compatibility layer restores edited-message pagination when a ChatGPT frontend experiment hides it.
- **Canonical topology** — graph ancestry comes from ChatGPT's backend conversation `mapping`, never DOM sibling order.
- **Stable answer expansion** — revealing a collapsed single assistant response does not move unrelated graph nodes.
- **Stable message details** — full-message text opens as an overlay without changing Dagre node geometry.
- **ChatGPT-native styling** — the dock derives its visual system from the active ChatGPT theme.
- **Local persistence** — normalized graph data and preferences stay in the browser.

## Graph controls

| Interaction | Action |
| --- | --- |
| Left-click a node | Navigate ChatGPT to that message and branch |
| Double-click a node | Focus the graph viewport on that node |
| Drag the canvas | Pan the graph |
| Right-drag the canvas | Pan without opening the browser context menu |
| Mouse wheel / trackpad | Pan or zoom through React Flow controls |
| `+` / `-` on a question | Reveal or hide its single assistant response |
| Message-detail button | Show or hide the full message without relayout |
| Panel left edge | Resize the dock |
| Panel chevron | Collapse or expand the dock |

## Installation

### GitHub Actions artifact

Every push builds a ready-to-load Chrome extension artifact.

1. Open the repository's **Actions** tab.
2. Select **Build installable extension**.
3. Open the latest successful run for the branch you want.
4. Download and extract the `chatgpt-graph-extension-...` artifact.
5. Open `chrome://extensions` and enable **Developer mode**.
6. Choose **Load unpacked** and select the extracted directory containing `manifest.json`.

After an extension update, reload the extension and refresh existing ChatGPT tabs. The edited-message compatibility layer runs at `document_start`, so it cannot retrofit an already bootstrapped page.

### Local development

Requirements: Node.js 18+, npm, and a Chromium-based browser.

```bash
git clone https://github.com/32V/chatgpt-graph-navigator.git
cd chatgpt-graph-navigator
npm ci
npm run build
```

Use `npm run dev` for watch mode or `npm run release` to create `release/` plus a ZIP archive.

## Architecture

```text
ChatGPT page
├── MAIN-world compatibility adapter (document_start)
├── content integration
│   ├── canonical mapping + current_node sync
│   ├── DOM change signals
│   ├── branch-navigation actuator
│   └── right-dock host
│
├── service worker
│   ├── message routing
│   ├── ChatGPT token capture
│   └── IndexedDB: conversations + nodes + edges
│
└── embedded React UI
    ├── Graph view
    └── Timeline tree
```

Two rules drive the implementation:

1. ChatGPT's backend `mapping` defines conversation topology, and `current_node` defines the active branch.
2. The DOM is used only to detect that canonical data may have changed or to actuate visible ChatGPT controls.

See [docs/architecture.md](docs/architecture.md) for details.

## Project structure

```text
├── assets/                      # Extension icons and active UI assets
├── docs/                        # Architecture and development notes
├── scripts/                     # Release and regression checks
├── src/
│   ├── background/              # MV3 service worker and persistence
│   ├── content/                 # ChatGPT integration and navigation
│   ├── popup/                   # Settings popup
│   ├── setup/                   # Optional manual token setup
│   ├── shared/                  # Small cross-context helpers
│   └── sidepanel/               # Embedded React graph/timeline UI
├── build.js                     # esbuild configuration
└── manifest.json                # Chrome extension manifest
```

## Regression checks

CI runs the same checks before packaging:

```bash
node scripts/check-no-chinese.mjs
node scripts/test-edit-pagination-compat.mjs
node scripts/test-current-node.mjs
node scripts/test-qa-tree-model.mjs
node scripts/test-assistant-stream-normalizer.mjs
node scripts/test-qa-tree-layout.mjs
npm run release
```

The tests cover the early ChatGPT compatibility adapter, canonical active-branch resolution, QA-tree construction, assistant-stream normalization, and the invariant that revealing a single assistant response does not move existing graph nodes.

## Compatibility notes

ChatGPT is an evolving private web application. The extension therefore keeps frontend coupling in narrow adapters:

- the early edited-message experiment compatibility layer;
- native previous/next version-control discovery;
- virtualized-turn mounting and scrolling.

Graph topology, active-path selection, persistence, and visualization remain independent of DOM adjacency.

## Privacy

Conversation graph data and the ChatGPT access token are stored locally in the browser and are not sent to project-operated servers. See [PRIVACY.md](PRIVACY.md).

## License

MIT.
