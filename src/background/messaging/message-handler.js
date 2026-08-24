/**
 * Runtime message routing for the MV3 service worker.
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';
import { db } from '../database/db.js';
import { clearToken } from '../auth/token-capture.js';

const CHATGPT_URL_RE = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;
const CONVERSATION_ID_RE = /\/c\/([a-f0-9-]+)/i;

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const task = handleMessage(message, sender);
    if (!task) return false;

    task
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  });
}

function handleMessage(message, sender) {
  const { type, payload } = message || {};

  switch (type) {
    case MESSAGE_TYPES.CONVERSATION_LOADED:
      return handleConversationLoaded(payload);
    case MESSAGE_TYPES.GET_CONVERSATION:
      return handleGetConversation(payload);
    case MESSAGE_TYPES.DOCK_HOST_COMMAND:
      return handleDockHostCommand(payload, sender);
    case MESSAGE_TYPES.ERROR:
      console.error('[Background] Error from content script:', payload, sender);
      return Promise.resolve({ acknowledged: true });
    case MESSAGE_TYPES.CLEAR_TOKEN:
      return clearToken().then(success => ({ success }));
    default:
      return null;
  }
}

async function handleConversationLoaded(conversationData) {
  if (!conversationData?.id) throw new Error('Missing conversation data');
  await db.saveFullConversation(conversationData);
  await notifyPanel(MESSAGE_TYPES.DATA_READY, { conversationId: conversationData.id });
  return { conversationId: conversationData.id };
}

async function handleGetConversation(payload) {
  const conversationId = payload?.conversationId;
  if (!conversationId) throw new Error('Missing conversationId');
  return db.getFullConversation(conversationId);
}

async function handleDockHostCommand(payload, sender) {
  const tabId = sender?.tab?.id;
  const tabUrl = sender?.tab?.url || sender?.url || '';
  if (!tabId || !CHATGPT_URL_RE.test(tabUrl)) {
    throw new Error('Dock command did not originate from a ChatGPT tab');
  }

  const hostConversationId = tabUrl.match(CONVERSATION_ID_RE)?.[1] || null;
  const requestedConversationId = payload?.conversationId || null;
  if (!hostConversationId || hostConversationId !== requestedConversationId) {
    throw new Error('Dock command targets a stale conversation');
  }

  let message;
  if (payload?.command === 'refresh') {
    message = {
      type: MESSAGE_TYPES.REFRESH_DATA,
      payload: { conversationId: hostConversationId }
    };
  } else if (payload?.command === 'navigate') {
    if (!payload.messageId) throw new Error('Missing messageId');
    message = {
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId: payload.messageId }
    };
  } else {
    throw new Error(`Unsupported dock command: ${payload?.command || '(none)'}`);
  }

  return sendMessageToTabWithFallback(tabId, message, { retryDelayMs: 500 });
}

async function notifyPanel(type, payload) {
  try {
    await chrome.runtime.sendMessage({ type, payload, timestamp: Date.now() });
  } catch {
    // The embedded panel may not be open yet.
  }
}
