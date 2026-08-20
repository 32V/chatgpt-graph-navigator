/**
 * Docked conversation graph panel injected into ChatGPT.
 * Behaves like a secondary sidebar: automatic, resizable, collapsible, and
 * theme-synchronized with the host page.
 */

import { log, throttle } from '../../shared/utils.js';

const PANEL_ID = '__chatgpt_graph_docked_panel__';
const STYLE_ID = '__chatgpt_graph_docked_panel_style__';
const BODY_CLASS = 'cg-graph-dock-visible';
const STORAGE_KEY = 'chatgpt_graph_dock_state_v1';
const MIN_WIDTH = 260;
const DEFAULT_WIDTH = 380;
const RAIL_WIDTH = 36;
const MIN_CHAT_REMAINDER = 320;
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;
const CONVERSATION_PATH_RE = /^\/c\/[0-9a-f-]+/i;

let currentState = null;
let themeObserver = null;
let mediaQuery = null;
let mediaListener = null;
let panelMessageListener = null;
let viewportResizeListener = null;
let routeTimer = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMaxPanelWidth() {
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_CHAT_REMAINDER);
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const stored = result?.[STORAGE_KEY];
    if (!stored || typeof stored !== 'object') {
      return { width: Math.min(DEFAULT_WIDTH, getMaxPanelWidth()), collapsed: false };
    }
    return {
      width: clamp(Number(stored.width) || DEFAULT_WIDTH, MIN_WIDTH, getMaxPanelWidth()),
      collapsed: stored.collapsed === true
    };
  } catch {
    return { width: Math.min(DEFAULT_WIDTH, getMaxPanelWidth()), collapsed: false };
  }
}

const saveState = throttle(async (state) => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch {
    // Best-effort persistence only.
  }
}, 120);

function ensureStyles() {
  const existing = document.getElementById(STYLE_ID);
  const style = existing || document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --cg-dock-occupied-width: 0px;
      --cg-host-bg: rgb(255, 255, 255);
      --cg-host-fg: rgb(13, 13, 13);
    }

    body.${BODY_CLASS} main {
      margin-right: var(--cg-dock-occupied-width) !important;
      transition: margin-right 160ms cubic-bezier(.2,.8,.2,1);
    }

    #${PANEL_ID} {
      position: fixed;
      inset: 0 0 0 auto;
      width: var(--cg-dock-panel-width, ${DEFAULT_WIDTH}px);
      height: 100dvh;
      z-index: 2147483645;
      display: flex;
      flex-direction: column;
      background: var(--cg-host-bg);
      color: var(--cg-host-fg);
      border-left: 1px solid color-mix(in srgb, var(--cg-host-fg) 12%, transparent);
      overflow: hidden;
      box-shadow: none;
      transition: width 160ms cubic-bezier(.2,.8,.2,1), background-color 120ms ease;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color-scheme: light dark;
    }

    #${PANEL_ID}.cg-dock-resizing {
      transition: none !important;
    }

    #${PANEL_ID}.cg-dock-collapsed { width: ${RAIL_WIDTH}px; }

    #${PANEL_ID} .cg-dock-resizer {
      position: absolute;
      left: -4px;
      top: 0;
      bottom: 0;
      width: 9px;
      cursor: ew-resize;
      z-index: 4;
      touch-action: none;
    }

    #${PANEL_ID} .cg-dock-resizer::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      width: 1px;
      background: transparent;
      transition: background-color 120ms ease;
    }

    #${PANEL_ID} .cg-dock-resizer:hover::after,
    #${PANEL_ID}.cg-dock-resizing .cg-dock-resizer::after {
      background: color-mix(in srgb, var(--cg-host-fg) 30%, transparent);
    }

    #${PANEL_ID}.cg-dock-collapsed .cg-dock-resizer { display: none; }

    #${PANEL_ID} .cg-dock-header {
      height: 44px;
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border-bottom: 1px solid color-mix(in srgb, var(--cg-host-fg) 10%, transparent);
      background: var(--cg-host-bg);
    }

    #${PANEL_ID}.cg-dock-collapsed .cg-dock-header {
      height: 100%;
      min-height: 0;
      padding: 6px 4px;
      flex-direction: column;
      border-bottom: 0;
      justify-content: flex-start;
    }

    #${PANEL_ID} .cg-dock-title {
      min-width: 0;
      margin-right: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${PANEL_ID} .cg-dock-segment {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
    }

    #${PANEL_ID} .cg-dock-button {
      width: 28px;
      height: 28px;
      border: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }

    #${PANEL_ID} .cg-dock-button img {
      width: 16px;
      height: 16px;
      filter: var(--cg-dock-icon-filter, none);
    }

    #${PANEL_ID}.cg-dock-collapsed .cg-dock-title,
    #${PANEL_ID}.cg-dock-collapsed .cg-dock-segment,
    #${PANEL_ID}.cg-dock-collapsed [data-action="refresh"] { display: none; }

    #${PANEL_ID} .cg-dock-body {
      flex: 1 1 auto;
      min-height: 0;
      background: var(--cg-host-bg);
    }

    #${PANEL_ID}.cg-dock-collapsed .cg-dock-body { display: none; }

    #${PANEL_ID} iframe {
      width: 100%;
      height: 100%;
      display: block;
      border: 0;
      background: var(--cg-host-bg);
    }
  `;
  if (!existing) document.documentElement.appendChild(style);
}

function getPanel() {
  return document.getElementById(PANEL_ID);
}

function parseRgb(color) {
  const match = String(color || '').match(/rgba?\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isTransparent(color) {
  return !color || color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\)/i.test(color);
}

function luminance(color) {
  const rgb = parseRgb(color);
  if (!rgb) return 1;
  const channels = rgb.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function readChatGptTheme() {
  const elements = [document.querySelector('main'), document.body, document.documentElement].filter(Boolean);
  let background = '';
  let foreground = '';

  for (const element of elements) {
    const style = getComputedStyle(element);
    if (!background && !isTransparent(style.backgroundColor)) background = style.backgroundColor;
    if (!foreground && style.color) foreground = style.color;
  }

  const darkClass = document.documentElement.classList.contains('dark') || document.body?.classList.contains('dark');
  const dark = darkClass || (background ? luminance(background) < 0.32 : false);
  return {
    mode: dark ? 'dark' : 'light',
    background: background || (dark ? 'rgb(33, 33, 33)' : 'rgb(255, 255, 255)'),
    foreground: foreground || (dark ? 'rgb(236, 236, 236)' : 'rgb(13, 13, 13)')
  };
}

function postToFrame(panel, message) {
  const frame = panel?.querySelector('iframe');
  try { frame?.contentWindow?.postMessage(message, EXTENSION_ORIGIN); } catch {}
}

function applyTheme(panel) {
  if (!panel) return;
  const theme = readChatGptTheme();
  panel.style.setProperty('--cg-host-bg', theme.background);
  panel.style.setProperty('--cg-host-fg', theme.foreground);
  panel.style.setProperty('--cg-dock-icon-filter', theme.mode === 'dark' ? 'invert(1)' : 'none');
  postToFrame(panel, { type: 'CG_THEME', payload: theme });
}

function stopThemeSync() {
  themeObserver?.disconnect();
  themeObserver = null;
  if (mediaQuery && mediaListener) {
    try { mediaQuery.removeEventListener('change', mediaListener); } catch {}
  }
  mediaQuery = null;
  mediaListener = null;
}

function startThemeSync(panel) {
  stopThemeSync();
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => applyTheme(panel), 40);
  };

  themeObserver = new MutationObserver(schedule);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme']
  });
  if (document.body) {
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme']
    });
  }

  try {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaListener = schedule;
    mediaQuery.addEventListener('change', mediaListener);
  } catch {
    mediaQuery = null;
    mediaListener = null;
  }
  applyTheme(panel);
}

function applyLayout(panel, state) {
  const width = clamp(state.width, MIN_WIDTH, getMaxPanelWidth());
  if (width !== state.width) {
    currentState = { ...state, width };
    state = currentState;
  }

  const occupied = state.collapsed ? RAIL_WIDTH : state.width;
  panel.style.setProperty('--cg-dock-panel-width', `${state.width}px`);
  panel.classList.toggle('cg-dock-collapsed', state.collapsed);
  document.documentElement.style.setProperty('--cg-dock-occupied-width', `${occupied}px`);
  document.body?.classList.add(BODY_CLASS);

  const collapseButton = panel.querySelector('[data-action="collapse"]');
  if (collapseButton) {
    collapseButton.textContent = state.collapsed ? '‹' : '›';
    collapseButton.title = state.collapsed ? 'Expand conversation graph' : 'Collapse conversation graph';
    collapseButton.setAttribute('aria-label', collapseButton.title);
  }
}

function setupResize(panel) {
  const handle = panel.querySelector('.cg-dock-resizer');
  if (!handle) return;

  handle.addEventListener('pointerdown', (event) => {
    if (!currentState || currentState.collapsed || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    panel.classList.add('cg-dock-resizing');
    const startX = event.clientX;
    const startWidth = currentState.width;

    const onMove = (moveEvent) => {
      const nextWidth = clamp(
        startWidth + (startX - moveEvent.clientX),
        MIN_WIDTH,
        getMaxPanelWidth()
      );
      currentState = { ...currentState, width: nextWidth };
      applyLayout(panel, currentState);
      saveState(currentState);
    };

    const onUp = () => {
      panel.classList.remove('cg-dock-resizing');
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  });

  viewportResizeListener = () => {
    if (!currentState || currentState.collapsed) return;
    const nextWidth = clamp(currentState.width, MIN_WIDTH, getMaxPanelWidth());
    if (nextWidth === currentState.width) return;
    currentState = { ...currentState, width: nextWidth };
    applyLayout(panel, currentState);
    saveState(currentState);
  };
  window.addEventListener('resize', viewportResizeListener);
}

function setActiveView(panel, mode) {
  panel.querySelectorAll('[data-view-mode]').forEach((button) => {
    button.classList.toggle('cg-active', button.dataset.viewMode === mode);
  });
}

function setupControls(panel) {
  panel.querySelectorAll('[data-view-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.viewMode;
      setActiveView(panel, mode);
      postToFrame(panel, { type: 'CG_SET_VIEW_MODE', payload: { mode } });
    });
  });

  panel.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    postToFrame(panel, { type: 'CG_REFRESH' });
  });

  panel.querySelector('[data-action="collapse"]')?.addEventListener('click', () => {
    if (!currentState) return;
    currentState = { ...currentState, collapsed: !currentState.collapsed };
    applyLayout(panel, currentState);
    saveState(currentState);
  });

  const frame = panel.querySelector('iframe');
  panelMessageListener = (event) => {
    if (event.source !== frame?.contentWindow) return;
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'CG_READY') {
      applyTheme(panel);
      postToFrame(panel, { type: 'CG_REQUEST_VIEW_MODE' });
    } else if (data.type === 'CG_VIEW_MODE' && data.payload?.mode) {
      setActiveView(panel, String(data.payload.mode));
    } else if (data.type === 'CG_THEME_REQUEST') {
      applyTheme(panel);
    }
  };
  window.addEventListener('message', panelMessageListener);
}

async function createPanel() {
  ensureStyles();
  currentState = await loadState();

  const initialTheme = readChatGptTheme();
  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.style.setProperty('--cg-host-bg', initialTheme.background);
  panel.style.setProperty('--cg-host-fg', initialTheme.foreground);
  panel.style.setProperty('--cg-dock-icon-filter', initialTheme.mode === 'dark' ? 'invert(1)' : 'none');
  panel.setAttribute('aria-label', 'Conversation graph');
  panel.innerHTML = `
    <div class="cg-dock-resizer" aria-hidden="true"></div>
    <div class="cg-dock-header">
      <div class="cg-dock-title">Conversation graph</div>
      <div class="cg-dock-segment" role="group" aria-label="Graph view">
        <button class="cg-dock-button" data-view-mode="graph" title="Graph view" aria-label="Graph view">
          <img src="${chrome.runtime.getURL('assets/graph.svg')}" alt="">
        </button>
        <button class="cg-dock-button" data-view-mode="tree" title="Tree view" aria-label="Tree view">
          <img src="${chrome.runtime.getURL('assets/tree.svg')}" alt="">
        </button>
      </div>
      <button class="cg-dock-button" data-action="refresh" title="Refresh graph" aria-label="Refresh graph">
        <img src="${chrome.runtime.getURL('assets/fresh.svg')}" alt="">
      </button>
      <button class="cg-dock-button cg-dock-collapse" data-action="collapse" aria-label="Collapse conversation graph"></button>
    </div>
    <div class="cg-dock-body">
      <iframe title="Conversation graph" src="${chrome.runtime.getURL(`src/sidepanel/index.html?embedded=1&dock=1&theme=${initialTheme.mode}`)}"></iframe>
    </div>
  `;

  document.body.appendChild(panel);
  applyLayout(panel, currentState);
  setupResize(panel);
  setupControls(panel);
  startThemeSync(panel);
  log('info', 'DockedPanel', 'Conversation graph dock opened');
  return panel;
}

export async function openDockPanel(options = {}) {
  let panel = getPanel();
  if (!panel) panel = await createPanel();

  if (options.expand === true && currentState?.collapsed) {
    currentState = { ...currentState, collapsed: false };
    applyLayout(panel, currentState);
    saveState(currentState);
  }

  applyTheme(panel);
  return true;
}

export function closeDockPanel() {
  const panel = getPanel();
  stopThemeSync();
  if (panelMessageListener) {
    window.removeEventListener('message', panelMessageListener);
    panelMessageListener = null;
  }
  if (viewportResizeListener) {
    window.removeEventListener('resize', viewportResizeListener);
    viewportResizeListener = null;
  }
  panel?.remove();
  document.body?.classList.remove(BODY_CLASS);
  document.documentElement.style.removeProperty('--cg-dock-occupied-width');
  log('info', 'DockedPanel', 'Conversation graph dock closed');
}

export async function toggleDockPanel() {
  const panel = getPanel();
  if (!panel) {
    await openDockPanel({ expand: true });
    return true;
  }

  if (!currentState) currentState = await loadState();
  currentState = { ...currentState, collapsed: !currentState.collapsed };
  applyLayout(panel, currentState);
  saveState(currentState);
  return !currentState.collapsed;
}

function isConversationRoute() {
  return CONVERSATION_PATH_RE.test(window.location.pathname || '');
}

async function syncDockToRoute() {
  if (isConversationRoute()) {
    if (!getPanel()) await openDockPanel();
  } else if (getPanel()) {
    closeDockPanel();
  }
}

function setupDockRuntime() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CG_TOGGLE_DOCKED_PANEL') return false;
    toggleDockPanel()
      .then(opened => sendResponse({ success: true, opened }))
      .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const tag = (target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
    if (typing || !event.altKey || !event.shiftKey || event.code !== 'KeyG') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleDockPanel();
  }, { capture: true });

  void syncDockToRoute();
  routeTimer = setInterval(() => { void syncDockToRoute(); }, 600);
}

if (!globalThis.__chatgptGraphDockInitialized) {
  globalThis.__chatgptGraphDockInitialized = true;
  setupDockRuntime();
}
