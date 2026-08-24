import { useCallback, useEffect, useRef, useState } from 'react';
import { MESSAGE_TYPES } from '../../shared/constants.js';

const HOST_COMMAND_TIMEOUT_MS = 8000;
const TRUSTED_HOST_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com'
]);

const HOST_ORIGIN = (() => {
  try {
    const origin = new URL(document.referrer).origin;
    return TRUSTED_HOST_ORIGINS.has(origin) ? origin : '*';
  } catch {
    return '*';
  }
})();

function postToHost(message) {
  window.parent?.postMessage(message, HOST_ORIGIN);
}

function isTrustedHostEvent(event) {
  return event.source === window.parent && TRUSTED_HOST_ORIGINS.has(event.origin);
}

async function sendRuntimeMessage(message) {
  if (!chrome.runtime?.id) throw new Error('Extension context invalidated');
  return chrome.runtime.sendMessage(message);
}

function transformToGraphData(payload) {
  if (!payload) return null;
  const conversation = payload.conversation || payload;
  return {
    id: conversation.id,
    currentNodeId: conversation.currentNodeId || null,
    nodes: payload.nodes || conversation.nodes || [],
    edges: payload.edges || conversation.edges || []
  };
}

export function useConversationData() {
  const [conversationData, setConversationData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentNodeId, setCurrentNodeId] = useState(null);

  const activeConversationRef = useRef(null);
  const pendingRefreshes = useRef(new Set());
  const pendingHostRequests = useRef(new Map());
  const requestSequence = useRef(0);

  const requestHostCommand = useCallback((command, payload = {}) => {
    return new Promise((resolve, reject) => {
      const requestId = `host-${Date.now()}-${++requestSequence.current}`;
      const timer = setTimeout(() => {
        pendingHostRequests.current.delete(requestId);
        reject(new Error(`Host command timed out: ${command}`));
      }, HOST_COMMAND_TIMEOUT_MS);

      pendingHostRequests.current.set(requestId, { resolve, reject, timer });
      postToHost({
        type: 'CG_HOST_COMMAND',
        payload: { requestId, command, ...payload }
      });
    });
  }, []);

  const triggerContentRefresh = useCallback(async (conversationId) => {
    if (!conversationId || pendingRefreshes.current.has(conversationId)) return;

    pendingRefreshes.current.add(conversationId);
    const timeout = setTimeout(() => pendingRefreshes.current.delete(conversationId), 5000);

    try {
      await requestHostCommand('refresh', { conversationId });
    } catch (refreshError) {
      pendingRefreshes.current.delete(conversationId);
      clearTimeout(timeout);
      throw refreshError;
    }
  }, [requestHostCommand]);

  const navigateToMessage = useCallback(async (messageId) => {
    const conversationId = activeConversationRef.current;
    if (!conversationId || !messageId) return false;

    const result = await requestHostCommand('navigate', {
      conversationId,
      messageId
    });
    return result?.success !== false;
  }, [requestHostCommand]);

  const fetchConversation = useCallback(async (conversationId, options = {}) => {
    const { requestIfMissing = true } = options;

    if (!conversationId) {
      setConversationData(null);
      setCurrentNodeId(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.GET_CONVERSATION,
        payload: { conversationId }
      });

      if (activeConversationRef.current !== conversationId) return;

      if (response?.success && response.data) {
        const graphData = transformToGraphData(response.data);
        pendingRefreshes.current.delete(conversationId);
        setConversationData(graphData);
        setCurrentNodeId(graphData.currentNodeId);
        return;
      }

      setConversationData(null);
      if (requestIfMissing) void triggerContentRefresh(conversationId);
    } catch (fetchError) {
      if (activeConversationRef.current !== conversationId) return;
      console.error('[Panel] Failed to fetch conversation:', fetchError);
      setConversationData(null);
      setError(fetchError.message || 'Failed to load conversation data');
    } finally {
      if (activeConversationRef.current === conversationId) setIsLoading(false);
    }
  }, [triggerContentRefresh]);

  const syncConversation = useCallback(async (conversationId) => {
    const nextId = conversationId || null;
    if (nextId === activeConversationRef.current) return;

    activeConversationRef.current = nextId;
    setConversationData(null);
    setCurrentNodeId(null);
    setError(null);

    if (!nextId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    await fetchConversation(nextId);
  }, [fetchConversation]);

  const refreshData = useCallback(async () => {
    const conversationId = activeConversationRef.current;
    if (!conversationId) return;
    await triggerContentRefresh(conversationId);
  }, [triggerContentRefresh]);

  useEffect(() => {
    const handleHostMessage = (event) => {
      if (!isTrustedHostEvent(event)) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'CG_HOST_CONTEXT') {
        void syncConversation(data.payload?.conversationId || null);
        return;
      }

      if (data.type !== 'CG_HOST_RESPONSE') return;
      const requestId = data.payload?.requestId;
      const pending = pendingHostRequests.current.get(requestId);
      if (!pending) return;

      pendingHostRequests.current.delete(requestId);
      clearTimeout(pending.timer);
      if (data.payload?.success === false) {
        pending.reject(new Error(data.payload?.error || 'Host command failed'));
      } else {
        pending.resolve(data.payload?.data);
      }
    };

    window.addEventListener('message', handleHostMessage);
    postToHost({ type: 'CG_REQUEST_HOST_CONTEXT' });

    return () => {
      window.removeEventListener('message', handleHostMessage);
      for (const pending of pendingHostRequests.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Panel closed'));
      }
      pendingHostRequests.current.clear();
    };
  }, [syncConversation]);

  useEffect(() => {
    const handleMessage = (message) => {
      if (message?.type !== MESSAGE_TYPES.DATA_READY) return;
      const conversationId = message.payload?.conversationId;
      if (!conversationId) return;

      pendingRefreshes.current.delete(conversationId);
      if (conversationId === activeConversationRef.current) {
        void fetchConversation(conversationId, { requestIfMissing: false });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [fetchConversation]);

  return {
    conversationData,
    isLoading,
    error,
    refreshData,
    navigateToMessage,
    currentNodeId,
    setCurrentNodeId
  };
}
