import { useState, useEffect, useCallback } from 'react';
import { buildQATree, updateSelectedPath } from '../utils/qa-tree.js';

/**
 * Build the QA tree and keep its selected path aligned with ChatGPT's canonical
 * `current_node`. Local node clicks still update immediately while the backend
 * snapshot catches up.
 */
export function useQATree(nodes, edges, options = {}) {
  const { activeNodeId = null } = options;
  const [tree, setTree] = useState(null);

  useEffect(() => {
    if (!nodes?.length) {
      setTree(null);
      return;
    }

    const nextTree = buildQATree(nodes, edges || []);
    const hasActiveNode = Boolean(
      activeNodeId &&
      (nextTree.qNodeMap.has(activeNodeId) || nextTree.aNodeMap.has(activeNodeId))
    );

    setTree(hasActiveNode ? updateSelectedPath(nextTree, activeNodeId) : nextTree);
  }, [nodes, edges, activeNodeId]);

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
