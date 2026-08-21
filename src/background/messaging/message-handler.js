/**
 * Runtime message routing for the MV3 service worker.
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';
import { db } from '../database/db.js';
import { clearToken } from '../auth/token-capture.js';

const CHATGPT_URL = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;

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
    case MESSAGE_TYPES.SCROLL_TO_MESSAGE:
      return handleScrollToMessage(payload, sender);
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

  const conversation = await db.getConversation(conversationId);
  if (!conversation) return null;

  const [nodes, edges] = await Promise.all([
    db.getNodes(conversationId),
    db.getEdges(conversationId)
  ]);
  return { conversation, nodes, edges };
}

async function handleScrollToMessage(payload, sender) {
  const messageId = payload?.messageId;
  if (!messageId) throw new Error('Missing messageId');

  let tab = sender?.tab || null;
  if (!tab?.id || !CHATGPT_URL.test(tab.url || '')) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }

  if (!tab?.id || !CHATGPT_URL.test(tab.url || '')) {
    throw new Error('No ChatGPT tab available for navigation');
  }

  return sendMessageToTabWithFallback(tab.id, {
    type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
    payload: { messageId }
  }, {
    retryDelayMs: 500
  });
}

async function notifyPanel(type, payload) {
  try {
    await chrome.runtime.sendMessage({ type, payload, timestamp: Date.now() });
  } catch {
    // The embedded panel may not be open yet.
  }
}
