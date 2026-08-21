import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow
} from '@xyflow/react';

import QANode from './QANode';
import StartNode from './StartNode';
import {
  buildAndLayoutQATree,
  GRAPH_NODE_WIDTH,
  GRAPH_NODE_HEIGHT,
  INLINE_ANSWER_WIDTH,
  INLINE_ANSWER_HEIGHT
} from '../utils/qaTreeLayout';

const nodeTypes = {
  qaNode: QANode,
  startNode: StartNode
};

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: { strokeWidth: 1.5 }
};

function getTreeStructureKey(qaTree) {
  if (!qaTree) return '';

  const nodeIds = [
    ...Array.from(qaTree.qNodeMap?.keys?.() || [], id => `q:${id}`),
    ...Array.from(qaTree.aNodeMap?.keys?.() || [], id => `a:${id}`)
  ];
  const parents = Array.from(qaTree.parentMap?.entries?.() || [], ([child, parent]) =>
    `p:${child}:${parent || ''}`
  );

  return [...nodeIds, ...parents].sort().join('|');
}

function GraphContent({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  showMiniMap
}) {
  const { fitView, setCenter, getZoom } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedQNodes, setExpandedQNodes] = useState(new Set());
  const previousStructureKeyRef = useRef('');
  const clickTimerRef = useRef(null);

  const structureKey = useMemo(() => getTreeStructureKey(qaTree), [qaTree]);

  const handleExpandAnswer = useCallback((nodeId) => {
    setExpandedQNodes(previous => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  useEffect(() => {
    setExpandedQNodes(previous => {
      if (!qaTree?.qNodeMap) return previous.size === 0 ? previous : new Set();

      let changed = false;
      const next = new Set();
      for (const id of previous) {
        if (qaTree.qNodeMap.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [qaTree]);

  useEffect(() => {
    if (!qaTree?.root?.questions?.length) {
      setNodes([]);
      setEdges([]);
      previousStructureKeyRef.current = '';
      return;
    }

    const structureChanged = previousStructureKeyRef.current !== structureKey;
    previousStructureKeyRef.current = structureKey;

    const layouted = buildAndLayoutQATree(qaTree, selectedPath, 'TB', expandedQNodes);
    setNodes(layouted.nodes.map(node => ({
      ...node,
      selected: Boolean(
        node.data?.nodeType !== 'start' &&
        node.data?.nodeId &&
        node.data.nodeId === currentNodeId
      ),
      data: {
        ...node.data,
        onExpandAnswer: handleExpandAnswer
      }
    })));
    setEdges(layouted.edges);

    if (structureChanged) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 260 });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [
    qaTree,
    selectedPath,
    currentNodeId,
    expandedQNodes,
    structureKey,
    setNodes,
    setEdges,
    fitView,
    handleExpandAnswer
  ]);

  const focusNode = useCallback((node) => {
    if (!node) return;
    if (node.data?.nodeType === 'start') {
      fitView({ padding: 0.25, duration: 240 });
      return;
    }

    const compact = node.data?.isInlineExpandedAnswer === true;
    const width = node.measured?.width || node.width ||
      (compact ? INLINE_ANSWER_WIDTH : GRAPH_NODE_WIDTH);
    const height = node.measured?.height || node.height ||
      (compact ? INLINE_ANSWER_HEIGHT : GRAPH_NODE_HEIGHT);
    const centerX = node.position.x + width / 2;
    const centerY = node.position.y + height / 2;
    const currentZoom = getZoom();
    const targetZoom = currentZoom < 0.78
      ? 1
      : Math.min(Math.max(currentZoom, 0.9), 1.22);

    setCenter(centerX, centerY, { zoom: targetZoom, duration: 260 });
  }, [fitView, getZoom, setCenter]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const handleNodeClick = useCallback((event, node) => {
    if (node.data?.nodeType === 'start' || event.detail > 1) return;

    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onNodeClick?.(node.data.nodeId, node.data);
    }, 170);
  }, [onNodeClick]);

  const handleNodeDoubleClick = useCallback((event, node) => {
    event.preventDefault();
    event.stopPropagation();

    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    focusNode(node);
  }, [focusNode]);

  const preventContextMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const nodeColor = useCallback((node) => {
    if (node.data?.nodeType === 'start') return '#777777';
    return node.selected ? '#a0a0a0' : '#686868';
  }, []);

  return (
    <ReactFlow
      className="cg-graph-interactive"
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      onNodeContextMenu={preventContextMenu}
      onPaneContextMenu={preventContextMenu}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      nodesDraggable={false}
      panOnDrag={[0, 1, 2]}
      selectionOnDrag={false}
      zoomOnDoubleClick={false}
      nodeDragThreshold={5}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Controls
        showZoom
        showFitView
        showInteractive={false}
        position="bottom-right"
      />

      {showMiniMap && (
        <MiniMap
          className="cg-minimap"
          style={{ width: 140, height: 105 }}
          nodeColor={nodeColor}
          nodeStrokeWidth={2}
          zoomable
          pannable
          position="bottom-left"
        />
      )}
    </ReactFlow>
  );
}

export default function ConversationGraph({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  showMiniMap = false
}) {
  return (
    <div className="graph-container">
      <ReactFlowProvider>
        <GraphContent
          qaTree={qaTree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={onNodeClick}
          showMiniMap={showMiniMap}
        />
      </ReactFlowProvider>
    </div>
  );
}
