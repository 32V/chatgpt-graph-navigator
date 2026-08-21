import React, { useEffect, useCallback, useState } from 'react';
import ConversationGraph from './components/ConversationGraph';
import GitTreeView from './components/GitTreeView';
import Header from './components/Header';
import { useConversationData } from './hooks/useConversationData';
import { useQATree } from './hooks/useQATree';
import { MESSAGE_TYPES } from '../shared/constants.js';

const IS_EMBEDDED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('embedded') === '1';
  } catch {
    return false;
  }
})();

const MINIMAP_VISIBLE_KEY = IS_EMBEDDED
  ? 'cg:minimap:visible:embedded'
  : 'cg:minimap:visible:sidebar';

function App() {
  const [viewMode, setViewMode] = useState('graph');
  const [miniMapVisible, setMiniMapVisible] = useState(() => {
    try {
      const saved = localStorage.getItem(MINIMAP_VISIBLE_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch {}
    return !IS_EMBEDDED;
  });

  const {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  } = useConversationData();

  const toggleMiniMap = useCallback(() => {
    setMiniMapVisible(value => !value);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MINIMAP_VISIBLE_KEY, miniMapVisible ? '1' : '0');
    } catch {}
  }, [miniMapVisible]);

  // The dock hosts this UI in an extension iframe and mirrors the view controls
  // in its ChatGPT-native header.
  useEffect(() => {
    if (!IS_EMBEDDED) return undefined;

    const handler = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;

      const { type, payload } = data;
      if (type === 'CG_SET_VIEW_MODE' && payload?.mode) {
        setViewMode(String(payload.mode));
      } else if (type === 'CG_REFRESH') {
        void refreshData();
      } else if (type === 'CG_REQUEST_VIEW_MODE') {
        event.source?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
      } else if (type === 'CG_TOGGLE_MINIMAP') {
        toggleMiniMap();
      } else if (type === 'CG_REQUEST_MINIMAP_STATE') {
        event.source?.postMessage({
          type: 'CG_MINIMAP_STATE',
          payload: { visible: miniMapVisible }
        }, '*');
      }
    };

    window.addEventListener('message', handler);
    window.parent?.postMessage({ type: 'CG_READY' }, '*');
    window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
    window.parent?.postMessage({
      type: 'CG_MINIMAP_STATE',
      payload: { visible: miniMapVisible }
    }, '*');

    return () => window.removeEventListener('message', handler);
  }, [viewMode, refreshData, miniMapVisible, toggleMiniMap]);

  useEffect(() => {
    if (!IS_EMBEDDED) return;
    window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
  }, [viewMode]);

  useEffect(() => {
    if (!IS_EMBEDDED) return;
    window.parent?.postMessage({
      type: 'CG_MINIMAP_STATE',
      payload: { visible: miniMapVisible }
    }, '*');
  }, [miniMapVisible]);

  useEffect(() => {
    chrome.storage.local.get(['sidepanelViewMode']).then((result) => {
      if (result.sidepanelViewMode) setViewMode(result.sidepanelViewMode);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    chrome.storage.local.set({ sidepanelViewMode: viewMode }).catch(() => {});
  }, [viewMode]);

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

    const messageId = nodeData?.messageId || nodeId;
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId }
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[SidePanel] Navigation request failed:', chrome.runtime.lastError.message);
      }
    });
  }, [setCurrentNodeId, selectNode]);

  const renderEmptyState = () => (
    <div className="empty-state">
      <div className="empty-icon">
        <img
          src={chrome.runtime.getURL('assets/icon128.png')}
          alt="ChatGPT Graph"
          style={{ width: '64px', height: '64px' }}
        />
      </div>
      <h2>No conversation loaded</h2>
      <p>Open a ChatGPT conversation to view its graph.</p>
    </div>
  );

  const renderContent = () => {
    if (!isTreeReady) {
      return (
        <div className="empty-state">
          <h2>Building conversation tree...</h2>
        </div>
      );
    }

    if (viewMode === 'tree') {
      return (
        <GitTreeView
          qaTree={tree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={handleNodeClick}
          showPanelControls={!IS_EMBEDDED}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onRefresh={refreshData}
          isLoading={isLoading}
        />
      );
    }

    return (
      <ConversationGraph
        qaTree={tree}
        selectedPath={selectedPath}
        currentNodeId={currentNodeId}
        onNodeClick={handleNodeClick}
        showMiniMap={miniMapVisible}
      />
    );
  };

  return (
    <div className={'app' + (IS_EMBEDDED ? ' embedded' : '')}>
      {!IS_EMBEDDED && (viewMode !== 'tree' || !conversationData || Boolean(error)) && (
        <Header
          onRefresh={refreshData}
          isLoading={isLoading}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          miniMapVisible={miniMapVisible}
          onToggleMiniMap={toggleMiniMap}
        />
      )}

      <main className="main-content">
        {error ? (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={refreshData}>Retry</button>
          </div>
        ) : !conversationData ? renderEmptyState() : renderContent()}
      </main>
    </div>
  );
}

export default App;
