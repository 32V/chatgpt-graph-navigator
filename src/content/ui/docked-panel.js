/**
 * ChatGPT-hosted conversation graph dock.
 *
 * This module owns behavior only: route visibility, resize/collapse state, theme
 * synchronization, and communication with the embedded graph UI. Presentation
 * lives in `docked-panel.css`.
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { extractConversationId, log, throttle } from '../../shared/utils.js';
import { createURLObserver } from '../observers/url-observer.js';

const PANEL_ID = '__chatgpt_graph_docked_panel__';
const BODY_CLASS = 'cg-graph-dock-visible';
const STORAGE_KEY = 'chatgpt_graph_dock_state_v1';
const MIN_WIDTH = 260;
const DEFAULT_WIDTH = 380;
const RAIL_WIDTH = 36;
const MIN_CHAT_REMAINDER = 320;
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;

let currentState = null;
let themeObserver = null;
let mediaQuery = null;
let mediaListener = null;
let panelMessageListener = null;
let viewportResizeListener = null;
let dockUrlObserver = null;
let lastContextConversationId = null;

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
    // Dock state persistence is best effort.
  }
}, 120);

function getPanel() {
  return document.getElementById(PANEL_ID);
}

function parseRgb(color) {
  const match = String(color || '').match(
    /rgba?\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i
  );
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
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function readChatGptTheme() {
  const elements = [
    document.querySelector('main'),
    document.body,
    document.documentElement
  ].filter(Boolean);

  let background = '';
  let foreground = '';
  for (const element of elements) {
    const style = getComputedStyle(element);
    if (!background && !isTransparent(style.backgroundColor)) background = style.backgroundColor;
    if (!foreground && style.color) foreground = style.color;
  }

  const hasDarkClass = document.documentElement.classList.contains('dark') ||
    document.body?.classList.contains('dark');
  const dark = hasDarkClass || (background ? luminance(background) < 0.32 : false);

  return {
    mode: dark ? 'dark' : 'light',
    background: background || (dark ? 'rgb(33, 33, 33)' : 'rgb(255, 255, 255)'),
    foreground: foreground || (dark ? 'rgb(236, 236, 236)' : 'rgb(13, 13, 13)')
  };
}

function postToFrame(panel, message) {
  const frame = panel?.querySelector('iframe');
  try {
    frame?.contentWindow?.postMessage(message, EXTENSION_ORIGIN);
  } catch {
    // The frame may be navigating or already gone.
  }
}

function postHostContext(panel, force = false) {
  const conversationId = extractConversationId();
  if (!force && conversationId === lastContextConversationId) return;
  lastContextConversationId = conversationId;
  postToFrame(panel, {
    type: 'CG_HOST_CONTEXT',
    payload: { conversationId }
  });
}

async function runHostCommand(panel, payload) {
  const requestId = payload?.requestId;
  if (!requestId) return;

  try {
    const conversationId = extractConversationId();
    if (!conversationId || payload?.conversationId !== conversationId) {
      throw new Error('Dock command targets a stale conversation');
    }

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DOCK_HOST_COMMAND,
      payload: {
        command: payload.command,
        conversationId,
        messageId: payload.messageId || null
      }
    });

    if (response?.success === false) {
      throw new Error(response.error || 'Host command failed');
    }

    postToFrame(panel, {
      type: 'CG_HOST_RESPONSE',
      payload: { requestId, success: true, data: response?.data }
    });
  } catch (error) {
    postToFrame(panel, {
      type: 'CG_HOST_RESPONSE',
      payload: {
        requestId,
        success: false,
        error: error?.message || String(error)
      }
    });
  }
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
    try {
      mediaQuery.removeEventListener('change', mediaListener);
    } catch {
      // Older browser implementations may not expose removeEventListener here.
    }
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
  const observerOptions = {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme']
  };
  themeObserver.observe(document.documentElement, observerOptions);
  if (document.body) themeObserver.observe(document.body, observerOptions);

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

  const occupiedWidth = state.collapsed ? RAIL_WIDTH : state.width;
  panel.style.setProperty('--cg-dock-panel-width', `${state.width}px`);
  panel.style.setProperty('--cg-dock-rail-width', `${RAIL_WIDTH}px`);
  panel.classList.toggle('cg-dock-collapsed', state.collapsed);
  document.documentElement.style.setProperty('--cg-dock-occupied-width', `${occupiedWidth}px`);
  document.body?.classList.add(BODY_CLASS);

  const collapseButton = panel.querySelector('[data-action="collapse"]');
  if (collapseButton) {
    const label = state.collapsed ? 'Expand conversation graph' : 'Collapse conversation graph';
    collapseButton.textContent = state.collapsed ? '‹' : '›';
    collapseButton.title = label;
    collapseButton.setAttribute('aria-label', label);
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
  panel.dataset.viewMode = mode;
  panel.querySelectorAll('[data-view-mode]').forEach((button) => {
    button.classList.toggle('cg-active', button.dataset.viewMode === mode);
  });
}

function setMiniMapActive(panel, visible) {
  const button = panel.querySelector('[data-action="minimap"]');
  if (!button) return;
  button.classList.toggle('cg-active', visible);
  button.setAttribute('aria-pressed', String(visible));
  button.title = visible ? 'Hide minimap' : 'Show minimap';
  button.setAttribute('aria-label', button.title);
}

function setupControls(panel) {
  panel.querySelectorAll('[data-view-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.viewMode;
      setActiveView(panel, mode);
      postToFrame(panel, { type: 'CG_SET_VIEW_MODE', payload: { mode } });
    });
  });

  panel.querySelector('[data-action="minimap"]')?.addEventListener('click', () => {
    postToFrame(panel, { type: 'CG_TOGGLE_MINIMAP' });
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
    if (event.source !== frame?.contentWindow || event.origin !== EXTENSION_ORIGIN) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'CG_READY') {
      applyTheme(panel);
      postHostContext(panel, true);
      postToFrame(panel, { type: 'CG_REQUEST_VIEW_MODE' });
      postToFrame(panel, { type: 'CG_REQUEST_MINIMAP_STATE' });
    } else if (data.type === 'CG_REQUEST_HOST_CONTEXT') {
      postHostContext(panel, true);
    } else if (data.type === 'CG_HOST_COMMAND') {
      void runHostCommand(panel, data.payload);
    } else if (data.type === 'CG_VIEW_MODE' && data.payload?.mode) {
      setActiveView(panel, String(data.payload.mode));
    } else if (data.type === 'CG_MINIMAP_STATE') {
      setMiniMapActive(panel, data.payload?.visible === true);
    } else if (data.type === 'CG_THEME_REQUEST') {
      applyTheme(panel);
    }
  };

  window.addEventListener('message', panelMessageListener);
}

async function createPanel() {
  currentState = await loadState();
  const initialTheme = readChatGptTheme();

  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.dataset.viewMode = 'graph';
  panel.style.setProperty('--cg-host-bg', initialTheme.background);
  panel.style.setProperty('--cg-host-fg', initialTheme.foreground);
  panel.style.setProperty('--cg-dock-icon-filter', initialTheme.mode === 'dark' ? 'invert(1)' : 'none');
  panel.setAttribute('aria-label', 'Conversation graph');
  panel.innerHTML = `
    <div class="cg-dock-resizer" aria-hidden="true"></div>
    <div class="cg-dock-header">
      <div class="cg-dock-title">Conversation graph</div>
      <div class="cg-dock-segment" role="group" aria-label="Conversation graph view">
        <button class="cg-dock-button cg-active" data-view-mode="graph" title="Graph view" aria-label="Graph view" type="button">
          <img src="${chrome.runtime.getURL('assets/graph.svg')}" alt="">
        </button>
        <button class="cg-dock-button" data-view-mode="tree" title="Tree view" aria-label="Tree view" type="button">
          <img src="${chrome.runtime.getURL('assets/tree.svg')}" alt="">
        </button>
      </div>
      <button class="cg-dock-button" data-action="minimap" title="Show minimap" aria-label="Show minimap" aria-pressed="false" type="button">
        <img src="${chrome.runtime.getURL('assets/minimap.svg')}" alt="">
      </button>
      <button class="cg-dock-button" data-action="refresh" title="Refresh graph" aria-label="Refresh graph" type="button">
        <img src="${chrome.runtime.getURL('assets/fresh.svg')}" alt="">
      </button>
      <button class="cg-dock-button cg-dock-collapse" data-action="collapse" aria-label="Collapse conversation graph" type="button"></button>
    </div>
    <div class="cg-dock-body">
      <iframe
        title="Conversation graph"
        src="${chrome.runtime.getURL(`src/sidepanel/index.html?theme=${initialTheme.mode}`)}"
      ></iframe>
    </div>
  `;

  document.body.appendChild(panel);
  applyLayout(panel, currentState);
  setupResize(panel);
  setupControls(panel);
  startThemeSync(panel);
  postHostContext(panel, true);
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
  postHostContext(panel);
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
  lastContextConversationId = null;
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

async function syncDockToRoute() {
  const conversationId = extractConversationId();
  if (conversationId) {
    if (!getPanel()) await openDockPanel();
    else postHostContext(getPanel());
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
    const tagName = (target?.tagName || '').toLowerCase();
    const isTyping = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
    if (isTyping || !event.altKey || !event.shiftKey || event.code !== 'KeyG') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void toggleDockPanel();
  }, { capture: true });

  void syncDockToRoute();
  dockUrlObserver = createURLObserver(() => syncDockToRoute(), 600);
}

if (!globalThis.__chatgptGraphDockInitialized) {
  globalThis.__chatgptGraphDockInitialized = true;
  setupDockRuntime();
}
