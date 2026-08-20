/**
 * Styles injected into ChatGPT for message collapsing.
 */

export const COLLAPSE_STYLES = `
.chatgpt-graph-collapsible {
  position: relative;
  transition: max-height 0.3s ease-out;
}

.chatgpt-graph-collapsed {
  max-height: 150px;
  overflow-y: auto;
  position: relative;
}

.chatgpt-graph-collapsed::-webkit-scrollbar {
  background: transparent;
  width: 16px;
}

.chatgpt-graph-collapsed::-webkit-scrollbar-thumb {
  background: var(--border-medium, #e5e5e5);
  border: 4px solid transparent;
  border-radius: 8px;
  background-clip: padding-box;
}

.chatgpt-graph-collapsed::-webkit-scrollbar-thumb:hover {
  background: var(--border-heavy, #c5c5c5);
  border: 4px solid transparent;
  background-clip: padding-box;
}

.chatgpt-graph-collapsed::after {
  content: '';
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, transparent, var(--main-surface-primary, #ffffff));
  pointer-events: none;
  display: block;
  margin-top: -30px;
}

.dark .chatgpt-graph-collapsed::after {
  background: linear-gradient(to bottom, transparent, var(--main-surface-primary, #212121));
}

.dark .chatgpt-graph-collapsed::-webkit-scrollbar-thumb {
  background: var(--border-medium, #444444);
  border: 4px solid transparent;
  background-clip: padding-box;
}

.dark .chatgpt-graph-collapsed::-webkit-scrollbar-thumb:hover {
  background: var(--border-heavy, #666666);
  border: 4px solid transparent;
  background-clip: padding-box;
}

.chatgpt-graph-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgb(93, 93, 93);
  cursor: pointer;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.chatgpt-graph-collapse-btn:hover {
  background: var(--token-bg-secondary, rgba(0, 0, 0, 0.05));
}

.chatgpt-graph-collapse-btn:active {
  background: var(--token-bg-tertiary, rgba(0, 0, 0, 0.1));
}

.chatgpt-graph-collapse-btn svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.dark .chatgpt-graph-collapse-btn {
  color: rgb(180, 180, 180);
}

.dark .chatgpt-graph-collapse-btn:hover {
  background: var(--token-bg-secondary, rgba(255, 255, 255, 0.1));
}
`;

export const COLLAPSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="17 11 12 6 7 11"></polyline>
  <polyline points="17 18 12 13 7 18"></polyline>
</svg>`;

export const EXPAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="7 13 12 18 17 13"></polyline>
  <polyline points="7 6 12 11 17 6"></polyline>
</svg>`;
