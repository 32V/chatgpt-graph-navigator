import { useState, useEffect, useCallback } from 'react';
import { buildQATree, updateSelectedPath } from '../utils/qa-tree.js';

/**
 * Build the QA tree from graph structure and update only the selected path when
 * ChatGPT's canonical `current_node` changes. Keeping the structural tree object
 * stable prevents unrelated tree-view expansion state from resetting.
 */
export function useQATree(nodes, edges, options = {}) {
  const { activeNodeId = null } = options;
  const [tree, setTree] = useState(null);

  useEffect(() => {
    if (!nodes?.length) {
      setTree(null);
      return;
    }
    setTree(buildQATree(nodes, edges || []));
  }, [nodes, edges]);

  useEffect(() => {
    if (!activeNodeId) return;
    setTree(currentTree => {
      if (!currentTree) return currentTree;
      if (!currentTree.qNodeMap.has(activeNodeId) && !currentTree.aNodeMap.has(activeNodeId)) {
        return currentTree;
      }
      if (currentTree.activeLeafId === activeNodeId) return currentTree;
      return updateSelectedPath(currentTree, activeNodeId);
    });
  }, [activeNodeId]);

  const selectNode = useCallback((nodeId) => {
    if (!nodeId) return;
    setTree(currentTree => {
      if (!currentTree) return currentTree;
      if (!currentTree.qNodeMap.has(nodeId) && !currentTree.aNodeMap.has(nodeId)) {
        return currentTree;
      }
      return updateSelectedPath(currentTree, nodeId);
    });
  }, []);

  return {
    tree,
    selectedPath: tree?.selectedPath || new Set(),
    selectNode,
    isReady: Boolean(tree?.root?.questions?.length)
  };
}

export default useQATree;
