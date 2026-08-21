import React, { useCallback, useEffect, useRef, useState } from 'react';
import ConversationGraph from './components/ConversationGraph';
import GitTreeView from './components/GitTreeView';
import { useConversationData } from './hooks/useConversationData';
import { useQATree } from './hooks/useQATree';
import { MESSAGE_TYPES } from '../shared/constants.js';

const MINIMAP_VISIBLE_KEY = 'cg:minimap:visible:embedded';
const VIEW_MODE_KEY = 'sidepanelViewMode';

function App() {
  const [viewMode, setViewMode] = useState('graph');
  const [miniMapVisible, setMiniMapVisible] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_VISIBLE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const viewModeRef = useRef(viewMode);
  const miniMapVisibleRef = useRef(miniMapVisible);
  viewModeRef.current = viewMode;
  miniMapVisibleRef.current = miniMapVisible;

  const {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  } = useConversationData();

  useEffect(() => {
    chrome.storage.local.get([VIEW_MODE_KEY]).then((result) => {
      const stored = result?.[VIEW_MODE_KEY];
      if (stored === 'graph' || stored === 'tree') setViewMode(stored);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    chrome.storage.local.set({ [VIEW_MODE_KEY]: viewMode }).catch(() => {});
    window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(MINIMAP_VISIBLE_KEY, miniMapVisible ? '1' : '0');
    } catch {}
    window.parent?.postMessage({
      type: 'CG_MINIMAP_STATE',
      payload: { visible: miniMapVisible }
    }, '*');
  }, [miniMapVisible]);

  useEffect(() => {
    const handler = (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      const { type, payload } = data;
      if (type === 'CG_SET_VIEW_MODE') {
        if (payload?.mode === 'graph' || payload?.mode === 'tree') setViewMode(payload.mode);
      } else if (type === 'CG_REFRESH') {
        void refreshData();
      } else if (type === 'CG_REQUEST_VIEW_MODE') {
        window.parent?.postMessage({
          type: 'CG_VIEW_MODE',
          payload: { mode: viewModeRef.current }
        }, '*');
      } else if (type === 'CG_TOGGLE_MINIMAP') {
        setMiniMapVisible(value => !value);
      } else if (type === 'CG_REQUEST_MINIMAP_STATE') {
        window.parent?.postMessage({
          type: 'CG_MINIMAP_STATE',
          payload: { visible: miniMapVisibleRef.current }
        }, '*');
      }
    };

    window.addEventListener('message', handler);
    window.parent?.postMessage({ type: 'CG_READY' }, '*');

    return () => window.removeEventListener('message', handler);
  }, [refreshData]);

  const {
    tree,
    selectedPath,
    selectNode,
    isReady: isTreeReady
  } = useQATree(
    conversationData?.nodes || null,
    conversationData?.edges || null,
    { activeNodeId: currentNodeId }
  );

  const handleNodeClick = useCallback((nodeId, nodeData) => {
    setCurrentNodeId(nodeId);
    selectNode(nodeId);

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId: nodeData?.messageId || nodeId }
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Panel] Navigation request failed:', chrome.runtime.lastError.message);
      }
    });
  }, [setCurrentNodeId, selectNode]);

  let content;
  if (error) {
    content = (
      <div className="error-message">
        <p>{error}</p>
        <button onClick={refreshData}>Retry</button>
      </div>
    );
  } else if (!conversationData) {
    content = (
      <div className="empty-state">
        <div className="empty-icon">
          <img
            src={chrome.runtime.getURL('assets/icon128.png')}
            alt=""
            width="56"
            height="56"
          />
        </div>
        <h2>No conversation loaded</h2>
        <p>Open a ChatGPT conversation to view its graph.</p>
      </div>
    );
  } else if (!isTreeReady) {
    content = (
      <div className="empty-state">
        <h2>Building conversation tree...</h2>
      </div>
    );
  } else if (viewMode === 'tree') {
    content = (
      <GitTreeView
        qaTree={tree}
        selectedPath={selectedPath}
        currentNodeId={currentNodeId}
        onNodeClick={handleNodeClick}
      />
    );
  } else {
    content = (
      <ConversationGraph
        qaTree={tree}
        selectedPath={selectedPath}
        currentNodeId={currentNodeId}
        onNodeClick={handleNodeClick}
        showMiniMap={miniMapVisible}
      />
    );
  }

  return (
    <div className="app embedded">
      <main className="main-content">{content}</main>
      {isLoading && conversationData && <div className="panel-loading-indicator" aria-label="Refreshing" />}
    </div>
  );
}

export default App;
