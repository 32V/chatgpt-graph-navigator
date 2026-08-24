/**
 * Main ChatGPT content script.
 *
 * The backend conversation mapping and `current_node` are the canonical graph
 * state. DOM observation is used only as a change signal and as a UI actuator.
 */

import {
  DEFAULT_ASSISTANT_STREAM_SETTINGS,
  MESSAGE_TYPES,
  CONFIG,
  STORAGE_KEYS
} from '../shared/constants.js';
import {
  log,
  extractConversationId,
  delay,
  initDebugLogSetting,
  getDebugLogEnabled
} from '../shared/utils.js';
import { loadToken, hasToken, initTokenListener } from './auth/token-manager.js';
import { fetchConversationWithRetry } from './api/conversation.js';
import { parseMapping } from './parser/mapping-parser.js';
import { normalizeAssistantStreamNodes } from './parser/assistant-stream-normalizer.js';
import { resolveCurrentNodeId } from './parser/current-node.js';
import { waitForElement } from './utils/dom-helper.js';
import { createURLObserver } from './observers/url-observer.js';
import { createMessageObserver } from './observers/message-observer.js';
import { conversationState } from './state/conversation-state.js';
import { navigateToMessage } from './utils/branch-navigator.js';
import {
  findArticleByMessageId,
  getAllMessageContainers,
  resolveMessageId
} from './utils/message-id-helper.js';
import { initCollapseManager, setupSettingsListener } from './collapse/collapse-manager.js';

const CONTENT_SCRIPT_GUARD = '__chatgptGraphContentInitialized__';
const CANONICAL_SYNC_USER_DELAY = 1500;
const CANONICAL_SYNC_ASSISTANT_DELAY = 250;
const CANONICAL_SYNC_RETRY_DELAY = 800;
const CANONICAL_SYNC_MAX_RETRIES = 3;

let urlObserver = null;
let messageObserver = null;
let activeConversationId = null;
let routeGeneration = 0;
let canonicalSyncTimer = null;
let canonicalSyncInFlight = false;
let canonicalSyncQueued = false;
let canonicalSyncRetryCount = 0;
const pendingObservedMessageIds = new Set();

async function loadAssistantStreamSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS);
    conversationState.setAssistantStreamSettings({
      ...DEFAULT_ASSISTANT_STREAM_SETTINGS,
      ...(result[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS] || {})
    });
  } catch (error) {
    log('warn', 'Content', 'Failed to load assistant stream settings:', error);
    conversationState.setAssistantStreamSettings(DEFAULT_ASSISTANT_STREAM_SETTINGS);
  }
}

function setupStorageListeners() {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]) {
      void loadAssistantStreamSettings().then(() => {
        const conversationId = extractConversationId();
        if (conversationId) return fetchAndProcessConversation(conversationId);
        return null;
      });
    }

    if (changes.accessToken?.newValue && !conversationState.isReady()) {
      const conversationId = extractConversationId();
      if (conversationId) void activateConversation(conversationId, { initialDelay: 0 });
    }
  });
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.SCROLL_TO_MESSAGE) {
      const messageId = message.payload?.messageId;
      if (!messageId) {
        sendResponse({ success: false, error: 'No messageId provided' });
        return true;
      }

      scrollToMessage(messageId)
        .then(success => sendResponse({ success }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.REFRESH_DATA) {
      refreshConversation(message.payload?.conversationId)
        .then(success => sendResponse({ success }))
        .catch(error => sendResponse({ success: false, error: error.message || 'Refresh failed' }));
      return true;
    }

    return false;
  });
}

async function refreshConversation(requestedConversationId) {
  const conversationId = requestedConversationId || extractConversationId();
  if (!conversationId) throw new Error('No conversationId');
  if (conversationId !== extractConversationId()) throw new Error('Conversation route changed');

  const tokenLoaded = await loadToken();
  if (!tokenLoaded || !hasToken()) throw new Error('No valid token configured');

  return Boolean(await fetchAndProcessConversation(conversationId));
}

async function scrollToMessage(messageId) {
  let targetElement = findMessageElement(messageId);
  if (targetElement) return scrollUntilVisible(targetElement);

  if (!conversationState.isReady()) return false;
  const nodes = conversationState.getNodes();
  if (!nodes?.length) return false;

  try {
    const result = await navigateToMessage(messageId, nodes);
    if (!result.success) {
      log('warn', 'Content', `Branch navigation failed: ${result.message}`);
      return false;
    }

    scheduleCanonicalSync(150);
    await delay(300);
    targetElement = findMessageElement(messageId);
    return targetElement ? scrollUntilVisible(targetElement) : false;
  } catch (error) {
    log('error', 'Content', 'Branch navigation error:', error);
    return false;
  }
}

function findScrollContainer(element) {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const scrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight;
    if (scrollable) return current;
    current = current.parentElement;
  }
  return document.documentElement;
}

function isElementNearViewportCenter(element) {
  const rect = element.getBoundingClientRect();
  const center = rect.top + rect.height / 2;
  return center >= window.innerHeight * 0.25 && center <= window.innerHeight * 0.75;
}

function waitForScrollToStop(container, timeout = 1500) {
  return new Promise((resolve) => {
    let lastScrollTop = container.scrollTop;
    let stableCount = 0;
    const startTime = Date.now();

    const check = () => {
      const currentScrollTop = container.scrollTop;
      if (Math.abs(currentScrollTop - lastScrollTop) < 1) {
        stableCount += 1;
        if (stableCount >= 3) {
          resolve();
          return;
        }
      } else {
        stableCount = 0;
        lastScrollTop = currentScrollTop;
      }

      if (Date.now() - startTime > timeout) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

function waitForDOMChangeOrTimeout(container, maxWait) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    const observer = new MutationObserver(cleanup);

    function cleanup() {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      if (timer) clearTimeout(timer);
      resolve();
    }

    observer.observe(container, { childList: true, subtree: true });
    timer = setTimeout(cleanup, maxWait);
  });
}

async function scrollUntilVisible(element) {
  const MAX_ATTEMPTS = 10;
  const DOM_WAIT_INITIAL = 100;
  const DOM_WAIT_MAX = 1500;
  const STUCK_THRESHOLD = 3;
  const SCROLL_TOLERANCE = 5;

  const scrollContainer = findScrollContainer(element);
  let lastScrollTop = scrollContainer.scrollTop;
  let domWaitTime = DOM_WAIT_INITIAL;
  let stuckCount = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (isElementNearViewportCenter(element)) {
      highlightElement(element);
      return true;
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await waitForScrollToStop(scrollContainer);
    await waitForDOMChangeOrTimeout(scrollContainer, domWaitTime);

    const currentScrollTop = scrollContainer.scrollTop;
    const scrollDelta = Math.abs(currentScrollTop - lastScrollTop);

    if (scrollDelta < SCROLL_TOLERANCE) {
      stuckCount += 1;
      domWaitTime = Math.min(Math.round(domWaitTime * 1.5), DOM_WAIT_MAX);
      if (stuckCount >= STUCK_THRESHOLD) {
        highlightElement(element);
        return false;
      }
    } else {
      stuckCount = 0;
      domWaitTime = DOM_WAIT_INITIAL;
    }

    lastScrollTop = currentScrollTop;
  }

  return false;
}

function findMessageElement(messageId) {
  if (!messageId) return null;

  const escapedId = window.CSS?.escape
    ? window.CSS.escape(messageId)
    : messageId.replace(/["\\]/g, '\\$&');

  let targetElement = document.querySelector(`[data-message-id="${escapedId}"]`);
  if (targetElement) return targetElement;

  const container = findArticleByMessageId(messageId);
  if (container) {
    return container.querySelector(`[data-message-id="${escapedId}"]`) ||
      container.querySelector('[data-message-author-role][data-message-id]') ||
      container.querySelector('[data-message-id]') ||
      container;
  }

  const MIN_SAFE_LENGTH = 5;
  if (messageId.length < MIN_SAFE_LENGTH) return null;

  for (const candidate of getAllMessageContainers()) {
    const domMessageId = resolveMessageId(candidate);
    const domTurnId = candidate.getAttribute('data-turn-id');
    const isMatch = value => Boolean(
      value &&
      value.length >= MIN_SAFE_LENGTH &&
      (value.includes(messageId) || messageId.includes(value))
    );

    if (isMatch(domMessageId) || isMatch(domTurnId)) {
      targetElement = candidate.querySelector('[data-message-author-role][data-message-id]') ||
        candidate.querySelector('[data-message-id]') ||
        candidate;
      break;
    }
  }

  return targetElement;
}

function highlightElement(element) {
  const previousOutline = element.style.outline;
  const previousOffset = element.style.outlineOffset;
  const previousTransition = element.style.transition;

  element.style.transition = 'outline-color 160ms ease';
  element.style.outline = '2px solid color-mix(in srgb, currentColor 38%, transparent)';
  element.style.outlineOffset = '2px';

  setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOffset;
    element.style.transition = previousTransition;
  }, 900);
}

async function main() {
  await initDebugLogSetting();
  if (!chrome.runtime?.id) return;

  initTokenListener();
  await loadAssistantStreamSettings();
  setupStorageListeners();
  setupMessageListener();
  setupSettingsListener();
  startURLObserver();

  try {
    await initCollapseManager();
  } catch (error) {
    log('warn', 'Content', 'Failed to initialize collapse manager:', error);
  }

  const conversationId = extractConversationId();
  if (conversationId) await activateConversation(conversationId);
}

function startURLObserver() {
  urlObserver?.stop();
  urlObserver = createURLObserver((newConversationId, oldConversationId) => {
    return handleRouteChange(newConversationId, oldConversationId);
  });
}

async function handleRouteChange(newConversationId, oldConversationId) {
  log('info', 'Content', 'Route changed', {
    from: oldConversationId || '(none)',
    to: newConversationId || '(none)'
  });

  if (!newConversationId) {
    deactivateConversation();
    return;
  }

  await activateConversation(newConversationId);
}

function deactivateConversation() {
  routeGeneration += 1;
  activeConversationId = null;
  resetCanonicalSyncState();
  messageObserver?.stop();
  messageObserver = null;
  conversationState.clear();
}

async function activateConversation(conversationId, options = {}) {
  if (!conversationId) return false;
  if (activeConversationId === conversationId && conversationState.isReady()) return true;

  const generation = ++routeGeneration;
  activeConversationId = conversationId;
  resetCanonicalSyncState();
  messageObserver?.stop();
  messageObserver = null;
  conversationState.clear();

  await waitForPageReady();
  if (generation !== routeGeneration || extractConversationId() !== conversationId) return false;

  const tokenLoaded = await loadToken();
  if (!tokenLoaded || !hasToken()) {
    log('warn', 'Content', 'Authentication token unavailable; waiting for token capture');
    return false;
  }

  const initialDelay = options.initialDelay ?? CONFIG.API_DELAY;
  if (initialDelay > 0) await delay(initialDelay);
  if (generation !== routeGeneration || extractConversationId() !== conversationId) return false;

  const result = await fetchAndProcessConversation(conversationId);
  if (!result || generation !== routeGeneration) return false;

  startMessageObserver();
  return true;
}

function resetCanonicalSyncState() {
  if (canonicalSyncTimer) {
    clearTimeout(canonicalSyncTimer);
    canonicalSyncTimer = null;
  }
  canonicalSyncQueued = false;
  canonicalSyncRetryCount = 0;
  pendingObservedMessageIds.clear();
}

function scheduleCanonicalSync(delayMs = CANONICAL_SYNC_ASSISTANT_DELAY) {
  if (canonicalSyncTimer) clearTimeout(canonicalSyncTimer);
  canonicalSyncTimer = setTimeout(() => {
    canonicalSyncTimer = null;
    void runCanonicalSync();
  }, delayMs);
}

async function runCanonicalSync() {
  if (canonicalSyncInFlight) {
    canonicalSyncQueued = true;
    return;
  }

  const conversationId = extractConversationId();
  if (!conversationId || !conversationState.isReady()) return;

  canonicalSyncInFlight = true;
  try {
    const result = await fetchAndProcessConversation(conversationId);
    if (!result) {
      if (extractConversationId() === conversationId && canonicalSyncRetryCount < CANONICAL_SYNC_MAX_RETRIES) {
        canonicalSyncRetryCount += 1;
        scheduleCanonicalSync(CANONICAL_SYNC_RETRY_DELAY * canonicalSyncRetryCount);
      }
      return;
    }

    for (const messageId of Array.from(pendingObservedMessageIds)) {
      if (result.mapping[messageId]) pendingObservedMessageIds.delete(messageId);
    }

    if (pendingObservedMessageIds.size > 0 && canonicalSyncRetryCount < CANONICAL_SYNC_MAX_RETRIES) {
      canonicalSyncRetryCount += 1;
      scheduleCanonicalSync(CANONICAL_SYNC_RETRY_DELAY * canonicalSyncRetryCount);
    } else {
      pendingObservedMessageIds.clear();
      canonicalSyncRetryCount = 0;
    }
  } catch (error) {
    log('error', 'Content', 'Canonical conversation sync failed:', error);
  } finally {
    canonicalSyncInFlight = false;
    if (canonicalSyncQueued) {
      canonicalSyncQueued = false;
      scheduleCanonicalSync(100);
    }
  }
}

function startMessageObserver() {
  messageObserver?.stop();
  messageObserver = createMessageObserver(handleMessageSignal);
}

function handleMessageSignal(signal) {
  if (!conversationState.isReady()) return;

  if (signal?.id) pendingObservedMessageIds.add(signal.id);
  if (getDebugLogEnabled()) {
    console.log('[ChatGPT Graph] Canonical sync scheduled', {
      id: signal?.id?.substring(0, 16),
      role: signal?.role
    });
  }

  scheduleCanonicalSync(
    signal?.role === 'user'
      ? CANONICAL_SYNC_USER_DELAY
      : CANONICAL_SYNC_ASSISTANT_DELAY
  );
}

async function waitForPageReady() {
  const mainElement = await waitForElement('main', 10000);
  if (!mainElement) throw new Error('Page load timeout');
}

async function fetchAndProcessConversation(conversationId) {
  try {
    const data = await fetchConversationWithRetry(conversationId);
    if (!data?.mapping) throw new Error('Invalid conversation data');
    if (extractConversationId() !== conversationId) return null;

    const parsed = parseMapping(data.mapping, conversationId);
    const normalized = normalizeAssistantStreamNodes(parsed.nodes, {
      mode: conversationState.assistantStreamSettings?.mode || DEFAULT_ASSISTANT_STREAM_SETTINGS.mode,
      conversationId
    });
    const nodes = normalized.nodes;
    const edges = parsed.nodes.length > 0 ? normalized.edges : parsed.edges;
    const currentNodeId = resolveCurrentNodeId(data.current_node, nodes, data.mapping);

    const conversationData = {
      id: conversationId,
      title: data.title,
      createTime: data.create_time,
      updateTime: data.update_time,
      currentNodeId,
      nodes,
      edges
    };

    conversationState.initialize(conversationData);
    await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);

    if (getDebugLogEnabled()) {
      console.log('[ChatGPT Graph] Canonical snapshot', {
        nodes: nodes.length,
        edges: edges.length,
        currentNodeId
      });
    }

    return { ...conversationData, mapping: data.mapping };
  } catch (error) {
    log('error', 'Content', 'Failed to process conversation:', error);
    try {
      await sendToBackground(MESSAGE_TYPES.ERROR, {
        message: error.message,
        stack: error.stack
      });
    } catch {}
    return null;
  }
}

async function sendToBackground(type, payload, retries = 3) {
  if (!chrome.runtime?.id) {
    throw new Error('Extension context invalidated. Please refresh the page.');
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload, timestamp: Date.now() }, (response) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else if (response?.error) reject(new Error(response.error));
          else resolve(response);
        });
      });
    } catch (error) {
      const connectionError = error.message?.includes('Receiving end does not exist');
      if (!connectionError) throw error;
      if (attempt === retries) {
        throw new Error('Background script not responding. Reload the extension or refresh the page.');
      }
      await delay(500 * attempt);
    }
  }

  return null;
}

if (globalThis[CONTENT_SCRIPT_GUARD]) {
  log('warn', 'Content', 'Content script already initialized, skipping duplicate bootstrap');
} else {
  globalThis[CONTENT_SCRIPT_GUARD] = true;
  main().catch(error => log('error', 'Content', 'Fatal error:', error));
}
