import { useState, useEffect, useCallback, useRef } from 'react';
import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';

const CONVERSATION_ID_REGEX = /\/c\/([a-f0-9-]+)/i;

async function queryActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

function conversationIdFromUrl(url = '') {
  return String(url).match(CONVERSATION_ID_REGEX)?.[1] || null;
}

async function getActiveConversationId() {
  return conversationIdFromUrl((await queryActiveTab())?.url);
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

  const triggerContentRefresh = useCallback(async (conversationId) => {
    if (!conversationId || pendingRefreshes.current.has(conversationId)) return;

    const tab = await queryActiveTab();
    if (!tab?.id || conversationIdFromUrl(tab.url) !== conversationId) return;

    pendingRefreshes.current.add(conversationId);
    const timeout = setTimeout(() => pendingRefreshes.current.delete(conversationId), 5000);

    try {
      const response = await sendMessageToTabWithFallback(tab.id, {
        type: MESSAGE_TYPES.REFRESH_DATA,
        payload: { conversationId }
      });
      if (response?.success === false) {
        pendingRefreshes.current.delete(conversationId);
        clearTimeout(timeout);
      }
    } catch (refreshError) {
      console.warn('[Panel] Content refresh failed:', refreshError?.message);
      pendingRefreshes.current.delete(conversationId);
      clearTimeout(timeout);
    }
  }, []);

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

      // A route change may complete while this IndexedDB request is in flight.
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

  const syncWithActiveTab = useCallback(async () => {
    const conversationId = await getActiveConversationId();
    if (conversationId === activeConversationRef.current) return;

    activeConversationRef.current = conversationId;
    setConversationData(null);
    setCurrentNodeId(null);
    setError(null);

    if (!conversationId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    await fetchConversation(conversationId);
  }, [fetchConversation]);

  const refreshData = useCallback(async () => {
    const conversationId = await getActiveConversationId();
    if (!conversationId) return;

    if (activeConversationRef.current !== conversationId) {
      activeConversationRef.current = conversationId;
      setConversationData(null);
      setCurrentNodeId(null);
    }
    await triggerContentRefresh(conversationId);
  }, [triggerContentRefresh]);

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

  useEffect(() => {
    void syncWithActiveTab();

    const onActivated = () => void syncWithActiveTab();
    const onUpdated = (_tabId, changeInfo, tab) => {
      if (tab?.active && changeInfo?.url) void syncWithActiveTab();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setInterval(() => void syncWithActiveTab(), 1500);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(timer);
    };
  }, [syncWithActiveTab]);

  return {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  };
}
