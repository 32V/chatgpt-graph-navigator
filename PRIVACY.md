# Privacy Policy for ChatGPT Graph Navigator

**Last updated: August 2026**

ChatGPT Graph Navigator is a browser extension that visualizes and navigates branched ChatGPT conversations. Its data processing happens locally in the browser.

## Data the extension accesses

The extension accesses only information needed to operate on ChatGPT:

- **ChatGPT access token** — captured from ChatGPT requests, or entered manually as a fallback, and stored in `chrome.storage.local`.
- **ChatGPT conversation data** — requested directly from ChatGPT's own backend API so the extension can reconstruct conversation nodes, edges, and the currently active branch.
- **Extension preferences** — panel state, graph settings, message-collapse settings, and developer logging preferences.

## Local storage

The extension stores data only in the current browser profile:

- `chrome.storage.local` stores the ChatGPT access token and extension preferences.
- IndexedDB stores canonical conversation metadata plus the normalized graph nodes and edges used by the navigator.

`chrome.storage.local` is local extension storage; the extension does not use Chrome sync storage.

Removing the extension removes its extension-owned local data. The stored ChatGPT token can also be cleared from the extension popup.

## Network communication

The extension communicates with ChatGPT domains only:

- `https://chatgpt.com/`
- `https://chat.openai.com/`

Conversation and authentication requests are sent to ChatGPT over HTTPS. The extension does not send conversation data or access tokens to a server operated by this project.

## Analytics and third parties

The extension does not include analytics, advertising, tracking pixels, telemetry services, or third-party data collection.

## Browser access

The extension is scoped to ChatGPT pages. It does not read arbitrary websites, local computer files, passwords, or browser history outside the permissions required to identify and communicate with active ChatGPT tabs.

## Changes

This policy may be updated when the extension's behavior changes. The date above reflects the latest revision.

## Contact

For questions or bug reports, open an issue in this repository:

https://github.com/32V/chatgpt-graph-navigator/issues
