/**
 * Runtime message routing for the MV3 service worker.
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';
import { db } from '../database/db.js';
import { getTokenStatus, clearToken } from '../auth/token-capture.js';

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.type);

    handleMessage(message, sender)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Keep the response channel alive for asynchronous handlers.
    return true;
  });

  console.log('[Background] Message listener setup complete');
}

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.CONVERSATION_LOADED:
      return handleConversationLoaded(payload);
    case MESSAGE_TYPES.CONVERSATION_INCREMENTAL_UPDATE:
      return handleIncrementalUpdate(payload);
    case MESSAGE_TYPES.GET_CONVERSATION:
      return handleGetConversation(payload);
    case MESSAGE_TYPES.GET_ALL_CONVERSATIONS:
      return handleGetAllConversations();
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
  try {
    console.log('[Background] Handling CONVERSATION_LOADED:', conversationData.id);
    await db.saveFullConversation(conversationData);

    await notifySidePanel(MESSAGE_TYPES.DATA_READY, {
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
  } catch (error) {
    console.error('[Background] Failed to save conversation:', error);
    throw error;
  }
}

async function handleIncrementalUpdate(updateData) {
  console.log('[Background] Handling INCREMENTAL_UPDATE:', {
    conversationId: updateData.conversationId,
    newNodeId: updateData.newNode?.id
  });

  try {
    const conversation = await db.getConversation(updateData.conversationId);
    const snapshot = {
      nodes: updateData.updatedNodes,
      edges: updateData.updatedEdges || [],
      rounds: updateData.updatedRounds,
      branches: updateData.updatedBranches,
      analysis: updateData.updatedAnalysis,
      updateTime: updateData.timestamp,
      lastIncrementalUpdate: updateData.timestamp
    };

    if (conversation) {
      await db.updateConversation(updateData.conversationId, snapshot);
    } else {
      console.warn('[Background] Conversation not found, saving as new');
      await db.saveFullConversation({
        id: updateData.conversationId,
        ...snapshot
      });
    }

    await notifySidePanel(MESSAGE_TYPES.UPDATE_NOTIFICATION, {
      type: 'new_message',
      conversationId: updateData.conversationId,
      newNode: updateData.newNode,
      stats: {
        nodes: updateData.updatedNodes?.length || 0,
        edges: updateData.updatedEdges?.length || 0,
        rounds: updateData.updatedRounds?.length || 0,
        branches: updateData.updatedBranches?.length || 0
      }
    });

    return {
      message: 'Incremental update saved successfully',
      conversationId: updateData.conversationId,
      newNodeId: updateData.newNode?.id
    };
  } catch (error) {
    console.error('[Background] Failed to save incremental update:', error);
    throw error;
  }
}

async function handleGetConversation(payload) {
  const { conversationId } = payload;
  console.log('[Background] Getting conversation:', conversationId);

  const conversation = await db.getConversation(conversationId);

  // The panel may initialize before the content script has written the first
  // canonical snapshot. Treat this as a normal cache miss.
  if (!conversation) return null;

  const [nodes, edges, rounds] = await Promise.all([
    db.getNodes(conversationId),
    db.getEdges(conversationId),
    db.getRounds(conversationId)
  ]);

  return { conversation, nodes, edges, rounds };
}

async function handleGetAllConversations() {
  const conversations = (await db.getAllConversations())
    .slice()
    .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0));

  return Promise.all(conversations.map(async (conversation) => {
    try {
      const [nodes, edges, rounds] = await Promise.all([
        db.getNodes(conversation.id),
        db.getEdges(conversation.id),
        db.getRounds(conversation.id)
      ]);
      return { ...conversation, nodes, edges, rounds };
    } catch (error) {
      console.error(`[Background] Failed to get full data for ${conversation.id}:`, error);
      return conversation;
    }
  }));
}

async function handleError(errorData) {
  console.error('[Background] Error from content script:', errorData);
  return { acknowledged: true };
}

async function handleScrollToMessage(payload) {
  const { messageId } = payload;
  console.log('[Background] Forwarding SCROLL_TO_MESSAGE:', messageId);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');
    if (!tab.url?.includes('chatgpt.com') && !tab.url?.includes('chat.openai.com')) {
      throw new Error('Active tab is not a ChatGPT page');
    }

    return await sendMessageToTabWithFallback(tab.id, {
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId }
    }, {
      retryDelayMs: 500
    });
  } catch (error) {
    console.error('[Background] Failed to forward SCROLL_TO_MESSAGE:', error);
    throw error;
  }
}

async function notifySidePanel(type, payload) {
  try {
    await chrome.runtime.sendMessage({
      type,
      payload,
      timestamp: Date.now()
    });
  } catch (error) {
    // The embedded panel may not be open yet.
    console.warn('[Background] Failed to notify side panel:', error.message);
  }
}
