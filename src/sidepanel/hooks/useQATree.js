import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  buildQATree,
  updateSelectedPath,
  switchToSibling,
  getSiblingInfo,
  isOnSelectedPath,
  getTreeStats,
  getSelectedPathAsList,
  debugPrintTree
} from '../utils/qa-tree.js';

/**
 * Builds the QA tree and owns its currently selected path.
 */
export function useQATree(nodes, edges, options = {}) {
  const { debug = false } = options;
  const [tree, setTree] = useState(null);

  useEffect(() => {
    if (!nodes?.length) {
      setTree(null);
      return;
    }

    const nextTree = buildQATree(nodes, edges || []);
    setTree(nextTree);
    if (debug) debugPrintTree(nextTree);
  }, [nodes, edges, debug]);

  const selectNode = useCallback((nodeId) => {
    if (!tree || !nodeId) return;
    setTree(updateSelectedPath(tree, nodeId));
  }, [tree]);

  const switchSibling = useCallback((nodeId, direction) => {
    if (!tree || !nodeId) return false;
    const nextTree = switchToSibling(nodeId, direction, tree);
    if (!nextTree) return false;
    setTree(nextTree);
    return true;
  }, [tree]);

  const switchToPrev = useCallback(
    nodeId => switchSibling(nodeId, 'prev'),
    [switchSibling]
  );

  const switchToNext = useCallback(
    nodeId => switchSibling(nodeId, 'next'),
    [switchSibling]
  );

  const getNodeSiblingInfo = useCallback(
    nodeId => tree && nodeId ? getSiblingInfo(nodeId, tree) : null,
    [tree]
  );

  const isNodeSelected = useCallback(
    nodeId => Boolean(tree && nodeId && isOnSelectedPath(nodeId, tree.selectedPath)),
    [tree]
  );

  const selectedPathList = useMemo(
    () => tree ? getSelectedPathAsList(tree) : [],
    [tree]
  );

  const stats = useMemo(
    () => tree ? getTreeStats(tree) : null,
    [tree]
  );

  const printTree = useCallback(() => {
    if (tree) debugPrintTree(tree);
  }, [tree]);

  return {
    tree,
    root: tree?.root || null,
    qNodeMap: tree?.qNodeMap || new Map(),
    aNodeMap: tree?.aNodeMap || new Map(),
    selectedPath: tree?.selectedPath || new Set(),
    activeLeafId: tree?.activeLeafId || null,
    selectedPathList,
    selectNode,
    switchToPrev,
    switchToNext,
    getNodeSiblingInfo,
    isNodeSelected,
    stats,
    printTree,
    isReady: Boolean(tree?.root?.questions?.length)
  };
}

/**
 * Compatibility listener for any future external branch-change notification.
 */
export function useBranchChangeListener(onBranchChange) {
  useEffect(() => {
    const handleMessage = (message) => {
      if (message?.type === 'BRANCH_CHANGED' && message?.payload?.nodeId) {
        onBranchChange?.(message.payload.nodeId);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [onBranchChange]);
}

export default useQATree;
