<div align="center">
  <img src="docs/pic/icon256.png" alt="ChatGPT Graph Navigator" width="112" />

  <h1>ChatGPT Graph Navigator</h1>
  <p><strong>A native-feeling conversation tree for ChatGPT.</strong></p>

  <p>
    <img alt="Chrome" src="https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white" />
    <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-10b981" />
    <img alt="React" src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white" />
    <img alt="React Flow" src="https://img.shields.io/badge/React%20Flow-12-111827" />
  </p>
</div>

ChatGPT Graph Navigator turns a branched ChatGPT conversation into an interactive graph and timeline. It runs directly on `chatgpt.com`, follows ChatGPT's light and dark themes, and keeps the graph available as a collapsible right-hand panel.

The extension is intentionally English-only.

## Highlights

- **Automatic docked panel** — opens on ChatGPT conversation pages and can be collapsed or resized.
- **Graph view** — inspect the full conversation topology, pan and zoom, and focus individual nodes.
- **Timeline tree** — browse the same conversation in a compact Git-style hierarchy with search and filtering.
- **Branch-aware navigation** — click a node to move ChatGPT to the corresponding message and branch.
- **Restored in-place version navigation** — a compatibility layer restores ChatGPT's edited-message pagination when the current frontend experiment hides it.
- **Canonical topology** — the graph is rebuilt from ChatGPT's backend conversation mapping rather than inferred from fragile DOM adjacency.
- **Theme matching** — the panel derives its surfaces, borders, text colors, and controls from the active ChatGPT theme.
- **Stable answer expansion** — revealing a collapsed assistant response does not relayout unrelated nodes.
- **Local persistence** — conversation graph data and extension preferences are stored in the browser.

## Graph controls

| Interaction | Action |
| --- | --- |
| Left-click a node | Navigate ChatGPT to that message/branch |
| Double-click a node | Focus the graph viewport on that node |
| Drag the canvas | Pan the graph |
| Right-drag the canvas | Pan without opening the browser context menu |
| Mouse wheel / trackpad | Pan or zoom through React Flow controls |
| `+` / `-` on a question | Reveal or hide its single assistant response |
| Panel left edge | Resize the dock |
| Panel chevron | Collapse or expand the dock |

## Installation

### GitHub Actions artifact

Every push builds a ready-to-load extension artifact.

1. Open the repository's **Actions** tab.
2. Select **Build installable extension**.
3. Open the latest successful run for your branch.
4. Download the `chatgpt-graph-extension-...` artifact.
5. Extract it.
6. Open `chrome://extensions`.
7. Enable **Developer mode**.
8. Choose **Load unpacked** and select the extracted directory that contains `manifest.json`.

After updating the extension, reload the extension in `chrome://extensions` and refresh existing ChatGPT tabs. The edited-message compatibility layer runs at `document_start`, so a page refresh is required after an extension update.

### Local build

Requirements:

- Node.js 18 or newer
- npm
- Chrome or another Chromium-based browser

```bash
git clone https://github.com/32V/chatgpt-graph-navigator.git
cd chatgpt-graph-navigator
npm ci
npm run build
```

For watch mode:

```bash
npm run dev
```

For a packaged release:

```bash
npm run release
```

The loadable extension is written to `release/`, and the release script also creates a ZIP archive.

## Architecture

The extension has four main runtime pieces:

```text
ChatGPT page
├── document_start MAIN-world compatibility layer
├── content script
│   ├── canonical conversation API sync
│   ├── branch navigation actuator
│   ├── DOM observers used as change signals
│   └── docked panel host
│
├── service worker
│   ├── message routing
│   ├── token capture
│   └── IndexedDB persistence
│
└── embedded React panel
    ├── Graph view
    └── Timeline tree
```

The important design rule is that **ChatGPT's backend `mapping` is the source of truth for conversation topology**. The DOM is used only where the extension must interact with ChatGPT's visible UI, such as selecting a native branch control or scrolling a virtualized turn into view.

See [docs/architecture.md](docs/architecture.md) for details.

## Project structure

```text
├── _locales/en/                 # English Chrome i18n catalog
├── assets/                      # Extension icons and UI assets
├── docs/                        # Architecture and development notes
├── scripts/                     # Release and regression checks
├── src/
│   ├── background/              # MV3 service worker and persistence
│   ├── content/                 # ChatGPT integration and navigation
│   ├── popup/                   # Extension settings popup
│   ├── setup/                   # Manual token setup page
│   ├── shared/                  # Shared constants and helpers
│   └── sidepanel/               # React graph/timeline interface
├── build.js                     # esbuild configuration
└── manifest.json                # Chrome extension manifest
```

## Development checks

The build workflow runs regression checks before packaging:

```bash
node scripts/check-no-chinese.mjs
node scripts/test-edit-pagination-compat.mjs
node scripts/test-qa-tree-layout.mjs
npm run release
```

`check-no-chinese.mjs` enforces the repository's English-only source and documentation policy.

## Notes on ChatGPT compatibility

This project integrates with an evolving, private web application. ChatGPT may change its DOM structure, virtualization behavior, or frontend experiments without notice. The implementation therefore minimizes DOM assumptions:

- topology comes from the backend conversation mapping;
- live DOM events trigger canonical resynchronization instead of creating graph ancestry;
- active branch navigation is verified by message IDs rather than assumed from visual ordering;
- edited-message pagination is restored before ChatGPT bootstraps when required by the active frontend experiment.

## Privacy

Conversation data is processed locally by the extension and stored in browser storage. See [PRIVACY.md](PRIVACY.md) for the current privacy statement.

## Contributing

Bug reports and focused improvements are welcome. When changing branch navigation, topology parsing, or graph layout, add or update a regression test whenever practical.

## License

GPL-3.0. See the repository license for details.
