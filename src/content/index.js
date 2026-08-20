/**
 * Main ChatGPT content script.
 *
 * The backend conversation mapping is the canonical graph. DOM observation is
 * used only to detect changes and to actuate navigation/scrolling in ChatGPT.
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
import { parseMapping, getNodeStatistics } from './parser/mapping-parser.js';
import { normalizeAssistantStreamNodes } from './parser/assistant-stream-normalizer.js';
import { extractBranches, buildRounds, analyzeBranchStructure } from './parser/branch-extractor.js';
import { isConversationPage, waitForElement } from './utils/dom-helper.js';
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

let urlObserver = null;
let messageObserver = null;
const CONTENT_SCRIPT_GUARD = '__chatgptGraphContentInitialized__';

const CANONICAL_SYNC_USER_DELAY = 1500;
const CANONICAL_SYNC_ASSISTANT_DELAY = 250;
const CANONICAL_SYNC_RETRY_DELAY = 800;
const CANONICAL_SYNC_MAX_RETRIES = 3;
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

function setupAssistantStreamSettingsListener() {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]) {
      void loadAssistantStreamSettings();
    }
  });
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.SCROLL_TO_MESSAGE) {
      const { messageId } = message.payload || {};
      if (!messageId) {
        sendResponse({ success: false, error: 'No messageId provided' });
        return true;
      }

      scrollToMessage(messageId)
        .then(success => sendResponse({ success }))
        .catch(error => {
          log('error', 'Content', 'scrollToMessage error:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    if (message.type === MESSAGE_TYPES.REFRESH_DATA) {
      (async () => {
        try {
          const conversationId = message.payload?.conversationId || extractConversationId();
          if (!conversationId) {
            sendResponse({ success: false, error: 'No conversationId' });
            return;
          }

          const tokenLoaded = await loadToken();
          if (!tokenLoaded || !hasToken()) {
            sendResponse({ success: false, error: 'No valid token configured' });
            return;
          }

          await fetchAndProcessConversation(conversationId);
          sendResponse({ success: true });
        } catch (error) {
          log('error', 'Content', 'Manual refresh failed:', error);
          sendResponse({ success: false, error: error.message || 'Refresh failed' });
        }
      })();
      return true;
    }

    if (message.type === MESSAGE_TYPES.ASSISTANT_STREAM_SETTINGS_CHANGED) {
      (async () => {
        await loadAssistantStreamSettings();
        const conversationId = extractConversationId();
        if (conversationId) await fetchAndProcessConversation(conversationId);
      })()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
      return true;
    }

    return false;
  });
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
    const observer = new MutationObserver(cleanup);

    function cleanup() {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      resolve();
    }

    observer.observe(container, { childList: true, subtree: true, attributes: false });
    setTimeout(cleanup, maxWait);
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

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
  element.style.transition = 'outline 0.3s ease, outline-offset 0.3s ease';
  element.style.outline = '3px solid #3b82f6';
  element.style.outlineOffset = '2px';

  setTimeout(() => {
    element.style.outline = '3px solid transparent';
    setTimeout(() => {
      element.style.removeProperty('outline');
      element.style.removeProperty('outline-offset');
      element.style.removeProperty('transition');
    }, 300);
  }, 1500);
}

async function main() {
  await initDebugLogSetting();

  if (!chrome.runtime?.id) {
    console.warn('[ChatGPT Graph] Extension context invalidated. Refresh this page.');
    return;
  }

  initTokenListener();
  await loadAssistantStreamSettings();
  setupAssistantStreamSettingsListener();
  setupMessageListener();
  setupSettingsListener();

  try {
    await initCollapseManager();
  } catch (error) {
    log('warn', 'Content', 'Failed to initialize collapse manager:', error);
  }

  if (!isConversationPage()) return;

  const conversationId = extractConversationId();
  if (!conversationId) return;

  await waitForPageReady();

  const tokenLoaded = await loadToken();
  if (!tokenLoaded || !hasToken()) {
    console.warn('[ChatGPT Graph] Authentication token unavailable. Use ChatGPT normally or open the extension settings.');
    return;
  }

  await delay(CONFIG.API_DELAY);
  await fetchAndProcessConversation(conversationId);
  startURLObserver();
  startMessageObserver();
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
    runCanonicalSync().catch(error => {
      log('error', 'Content', 'Canonical conversation sync failed:', error);
    });
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
    const conversationData = await fetchAndProcessConversation(conversationId);
    if (!conversationData) {
      if (extractConversationId() !== conversationId) return;
      if (canonicalSyncRetryCount < CANONICAL_SYNC_MAX_RETRIES) {
        canonicalSyncRetryCount += 1;
        scheduleCanonicalSync(CANONICAL_SYNC_RETRY_DELAY * canonicalSyncRetryCount);
      }
      return;
    }

    const mapping = conversationData.mapping || {};
    for (const messageId of Array.from(pendingObservedMessageIds)) {
      if (mapping[messageId]) pendingObservedMessageIds.delete(messageId);
    }

    if (pendingObservedMessageIds.size > 0 && canonicalSyncRetryCount < CANONICAL_SYNC_MAX_RETRIES) {
      canonicalSyncRetryCount += 1;
      scheduleCanonicalSync(CANONICAL_SYNC_RETRY_DELAY * canonicalSyncRetryCount);
    } else {
      pendingObservedMessageIds.clear();
      canonicalSyncRetryCount = 0;
    }
  } finally {
    canonicalSyncInFlight = false;
    if (canonicalSyncQueued) {
      canonicalSyncQueued = false;
      scheduleCanonicalSync(100);
    }
  }
}

function startURLObserver() {
  urlObserver?.stop();

  urlObserver = createURLObserver(async (newConversationId, oldConversationId) => {
    log('info', 'Content', `Conversation switched: ${oldConversationId} -> ${newConversationId}`);
    resetCanonicalSyncState();
    conversationState.clear();
    messageObserver?.reset();
    await delay(CONFIG.API_DELAY);
    await fetchAndProcessConversation(newConversationId);
  });
}

function startMessageObserver() {
  messageObserver?.stop();
  messageObserver = createMessageObserver(handleIncrementalMessage);
}

function handleIncrementalMessage(messageData) {
  if (!conversationState.isReady()) return;

  if (messageData?.id) pendingObservedMessageIds.add(messageData.id);
  logCanonicalSyncObservation(messageData);

  scheduleCanonicalSync(
    messageData?.role === 'user'
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
    const branches = extractBranches(nodes);
    const rounds = buildRounds(nodes);
    const analysis = analyzeBranchStructure(nodes);

    log('info', 'Content', 'Conversation parsed', {
      ...getNodeStatistics(nodes),
      edges: edges.length,
      branches: branches.length,
      rounds: rounds.length
    });

    const conversationData = {
      id: conversationId,
      title: data.title,
      createTime: data.create_time,
      updateTime: data.update_time,
      mapping: data.mapping,
      nodes,
      edges,
      rounds,
      branches,
      analysis
    };

    conversationState.initialize(conversationData);

    try {
      await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);
    } catch (error) {
      log('error', 'Content', 'Failed to send conversation to background:', error.message);
    }

    logDebugInfo(conversationData);
    return conversationData;
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

  for (let attempt = 1; attempt <= retries; attempt++) {
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

function logDebugInfo(conversationData) {
  if (!getDebugLogEnabled()) return;

  console.group('ChatGPT Graph - Conversation Data');
  console.log('Statistics:', {
    'Total Nodes': conversationData.nodes.length,
    'Total Edges': conversationData.edges.length,
    'User Messages': conversationData.nodes.filter(node => node.role === 'user').length,
    'Assistant Replies': conversationData.nodes.filter(node => node.role === 'assistant').length,
    Rounds: conversationData.rounds.length,
    Branches: conversationData.branches.length,
    'Branch Points': conversationData.analysis.branchPointsCount
  });
  console.groupEnd();
}

function logCanonicalSyncObservation(messageData) {
  if (!getDebugLogEnabled()) return;
  console.log('[ChatGPT Graph] Canonical sync scheduled', {
    id: messageData?.id?.substring(0, 16),
    role: messageData?.role
  });
}

if (globalThis[CONTENT_SCRIPT_GUARD]) {
  log('warn', 'Content', 'Content script already initialized, skipping duplicate bootstrap');
} else {
  globalThis[CONTENT_SCRIPT_GUARD] = true;
  main().catch(error => log('error', 'Content', 'Fatal error:', error));
}
