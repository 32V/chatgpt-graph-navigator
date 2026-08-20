/**
 * Runtime message routing for the MV3 service worker.
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';
import { db } from '../database/db.js';
import { getTokenStatus, clearToken } from '../auth/token-capture.js';

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  });
}

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.CONVERSATION_LOADED:
      return handleConversationLoaded(payload);
    case MESSAGE_TYPES.GET_CONVERSATION:
      return handleGetConversation(payload);
    case MESSAGE_TYPES.SCROLL_TO_MESSAGE:
      return handleScrollToMessage(payload);
    case MESSAGE_TYPES.ERROR:
      return handleError(payload, sender);
    case MESSAGE_TYPES.GET_TOKEN_STATUS:
      return getTokenStatus();
    case MESSAGE_TYPES.CLEAR_TOKEN:
      return { success: await clearToken() };
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

async function handleConversationLoaded(conversationData) {
  await db.saveFullConversation(conversationData);

  await notifyPanel(MESSAGE_TYPES.DATA_READY, {
    conversationId: conversationData.id,
    stats: {
      nodes: conversationData.nodes?.length || 0,
      edges: conversationData.edges?.length || 0,
      rounds: conversationData.rounds?.length || 0,
      branches: conversationData.branches?.length || 0
    }
  });

  return {
    message: 'Conversation saved successfully',
    conversationId: conversationData.id
  };
}

async function handleGetConversation(payload) {
  const { conversationId } = payload;
  const conversation = await db.getConversation(conversationId);

  // The panel may initialize before the content script writes its first
  // canonical snapshot. A missing record is a normal cache miss.
  if (!conversation) return null;

  const [nodes, edges, rounds] = await Promise.all([
    db.getNodes(conversationId),
    db.getEdges(conversationId),
    db.getRounds(conversationId)
  ]);

  return { conversation, nodes, edges, rounds };
}

async function handleError(errorData) {
  console.error('[Background] Error from content script:', errorData);
  return { acknowledged: true };
}

async function handleScrollToMessage(payload) {
  const { messageId } = payload;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) throw new Error('No active tab found');
  if (!tab.url?.includes('chatgpt.com') && !tab.url?.includes('chat.openai.com')) {
    throw new Error('Active tab is not a ChatGPT page');
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
