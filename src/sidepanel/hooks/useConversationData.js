import { useState, useEffect, useCallback, useRef } from 'react';
import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';

const CONVERSATION_ID_REGEX = /\/c\/([a-f0-9-]+)/;

function queryActiveTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs || []));
    } catch {
      resolve([]);
    }
  });
}

async function getActiveConversationIdFromTab() {
  const [tab] = await queryActiveTab();
  return (tab?.url || '').match(CONVERSATION_ID_REGEX)?.[1] || null;
}

async function sendRuntimeMessage(message) {
  if (!chrome.runtime?.id) throw new Error('Extension context invalidated');
  return chrome.runtime.sendMessage(message);
}

function transformToGraphData(payload) {
  if (!payload) return null;
  const conversation = payload.conversation || payload;
  const nodes = payload.nodes || conversation.nodes || [];
  const edges = payload.edges || conversation.edges || [];

  return {
    id: conversation.id,
    title: conversation.title || 'Untitled Conversation',
    currentNodeId: conversation.currentNodeId || null,
    nodes,
    edges,
    updatedAt: conversation.updateTime || Date.now(),
    stats: {
      totalNodes: nodes.length || conversation.nodeCount || 0,
      totalEdges: edges.length || conversation.edgeCount || 0
    }
  };
}

export function useConversationData() {
  const [conversationData, setConversationData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);

  const activeConversationRef = useRef(null);
  const pendingRefreshes = useRef(new Set());

  const setActiveConversation = useCallback((conversationId) => {
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
  }, []);

  const triggerContentRefresh = useCallback(async (conversationId) => {
    if (!conversationId || pendingRefreshes.current.has(conversationId)) return;

    const [tab] = await queryActiveTab();
    if (!tab?.id) return;

    pendingRefreshes.current.add(conversationId);
    const timeout = setTimeout(() => pendingRefreshes.current.delete(conversationId), 5000);

    try {
      await sendMessageToTabWithFallback(tab.id, {
        type: MESSAGE_TYPES.REFRESH_DATA,
        payload: { conversationId }
      });
    } catch (error) {
      console.warn('[Panel] Content refresh failed:', error?.message);
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

      if (response?.success && response.data) {
        const graphData = transformToGraphData(response.data);
        pendingRefreshes.current.delete(conversationId);
        setConversationData(graphData);
        setCurrentNodeId(graphData.currentNodeId);
        setActiveConversation(conversationId);
      } else {
        setConversationData(null);
        if (requestIfMissing) void triggerContentRefresh(conversationId);
      }
    } catch (fetchError) {
      console.error('[Panel] Failed to fetch conversation:', fetchError);
      setConversationData(null);
      setError(fetchError.message || 'Failed to load conversation data');
    } finally {
      setIsLoading(false);
    }
  }, [setActiveConversation, triggerContentRefresh]);

  const syncWithActiveTab = useCallback(async () => {
    const conversationId = await getActiveConversationIdFromTab();

    if (!conversationId) {
      setActiveConversation(null);
      setConversationData(null);
      setCurrentNodeId(null);
      setIsLoading(false);
      return;
    }

    if (conversationId !== activeConversationRef.current) {
      setActiveConversation(conversationId);
      setCurrentNodeId(null);
      await fetchConversation(conversationId);
    }
  }, [fetchConversation, setActiveConversation]);

  const refreshData = useCallback(async () => {
    const conversationId = await getActiveConversationIdFromTab();
    if (!conversationId) return;
    setActiveConversation(conversationId);
    await triggerContentRefresh(conversationId);
  }, [setActiveConversation, triggerContentRefresh]);

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
    setCurrentNodeId,
    activeConversationId
  };
}
