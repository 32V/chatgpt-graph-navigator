import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider
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

const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';
const MINIMAP_HANDLE_HEIGHT = 18;
const MINIMAP_POS_KEY = 'cg:minimap:pos';
const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 120;
const MINIMAP_MARGIN = 10;

function clampMiniMapOffset(offset, containerWidth, containerHeight) {
  const maxX = Math.max(0, containerWidth - MINIMAP_WIDTH - MINIMAP_MARGIN * 2);
  const minY = Math.min(0, -(containerHeight - MINIMAP_HEIGHT - MINIMAP_MARGIN * 2));
  return {
    x: Math.max(0, Math.min(maxX, offset.x)),
    y: Math.max(minY, Math.min(0, offset.y))
  };
}

function GraphContent({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  graphContainerRef,
  showMiniMap
}) {
  const { fitView, setCenter, getZoom } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedQNodes, setExpandedQNodes] = useState(new Set());
  const prevNodeCountRef = useRef(0);
  const clickTimerRef = useRef(null);

  const [miniMapOffset, setMiniMapOffset] = useState(() => {
    if (IS_EMBEDDED) return { x: 0, y: 0 };
    try {
      const raw = localStorage.getItem(MINIMAP_POS_KEY);
      if (!raw) return { x: 0, y: 0 };
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return { x: parsed.x, y: parsed.y };
      }
    } catch {
      // ignore
    }
    return { x: 0, y: 0 };
  });

  const miniMapOffsetRef = useRef(miniMapOffset);
  useEffect(() => {
    miniMapOffsetRef.current = miniMapOffset;
  }, [miniMapOffset]);

  useEffect(() => {
    if (IS_EMBEDDED || !showMiniMap) return;
    const container = graphContainerRef?.current;
    if (!container) return;

    const clampOffset = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const current = miniMapOffsetRef.current;
      const next = clampMiniMapOffset(current, width, height);
      if (next.x === current.x && next.y === current.y) return;
      setMiniMapOffset(next);
      try { localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify(next)); } catch {}
    };

    clampOffset();
    const observer = new ResizeObserver(clampOffset);
    observer.observe(container);
    return () => observer.disconnect();
  }, [showMiniMap, graphContainerRef]);

  useEffect(() => {
    if (IS_EMBEDDED || !showMiniMap) return;
    const root = graphContainerRef?.current || document;
    const panel = root.querySelector?.('[data-testid="rf__minimap"]');
    if (!panel) return;

    panel.classList.add('cg-minimap', 'cg-minimap-draggable');
    const drag = {
      dragging: false,
      startX: 0,
      startY: 0,
      startOffsetX: 0,
      startOffsetY: 0
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      if (event.clientY - rect.top > MINIMAP_HANDLE_HEIGHT) return;
      event.preventDefault();
      event.stopPropagation();
      drag.dragging = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.startOffsetX = miniMapOffsetRef.current.x;
      drag.startOffsetY = miniMapOffsetRef.current.y;
      panel.classList.add('cg-minimap-dragging');
      try { panel.setPointerCapture?.(event.pointerId); } catch {}
    };

    const onPointerMove = (event) => {
      if (!drag.dragging) return;
      setMiniMapOffset({
        x: drag.startOffsetX + event.clientX - drag.startX,
        y: drag.startOffsetY + event.clientY - drag.startY
      });
    };

    const endDrag = () => {
      if (!drag.dragging) return;
      drag.dragging = false;
      panel.classList.remove('cg-minimap-dragging');
      const container = graphContainerRef?.current;
      const next = container
        ? clampMiniMapOffset(
            miniMapOffsetRef.current,
            container.getBoundingClientRect().width,
            container.getBoundingClientRect().height
          )
        : miniMapOffsetRef.current;
      setMiniMapOffset(next);
      try { localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify(next)); } catch {}
    };

    panel.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    return () => {
      panel.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      panel.classList.remove('cg-minimap-dragging', 'cg-minimap-draggable');
    };
  }, [showMiniMap, graphContainerRef]);

  const handleExpandAnswer = useCallback((nodeId) => {
    setExpandedQNodes(previous => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!qaTree?.root?.questions?.length) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const semanticNodeCount = (qaTree.qNodeMap?.size || 0) + (qaTree.aNodeMap?.size || 0);
    const isTreeDataChange = prevNodeCountRef.current !== semanticNodeCount;
    prevNodeCountRef.current = semanticNodeCount;

    const layouted = buildAndLayoutQATree(qaTree, selectedPath, 'TB', expandedQNodes);
    setNodes(layouted.nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        onExpandAnswer: handleExpandAnswer
      }
    })));
    setEdges(layouted.edges);

    if (isTreeDataChange) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 260 });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [qaTree, selectedPath, expandedQNodes, setNodes, setEdges, fitView, handleExpandAnswer]);

  const focusNode = useCallback((node) => {
    if (!node) return;
    if (node.data?.nodeType === 'start') {
      fitView({ padding: 0.25, duration: 240 });
      return;
    }

    const compact = node.data?.isInlineExpandedAnswer === true;
    const width = node.measured?.width || node.width || (compact ? INLINE_ANSWER_WIDTH : GRAPH_NODE_WIDTH);
    const height = node.measured?.height || node.height || (compact ? INLINE_ANSWER_HEIGHT : GRAPH_NODE_HEIGHT);
    const centerX = node.position.x + width / 2;
    const centerY = node.position.y + height / 2;
    const currentZoom = getZoom();
    const targetZoom = currentZoom < 0.78 ? 1.0 : Math.min(Math.max(currentZoom, 0.9), 1.22);
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
    if (node.data?.nodeType !== 'start') {
      onNodeDoubleClick?.(node.data.nodeId, node.data);
    }
  }, [focusNode, onNodeDoubleClick]);

  const handleNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    event.stopPropagation();
    if (node.data?.nodeType === 'start') return;
    onNodeContextMenu?.(event, node.data.nodeId, node.data);
  }, [onNodeContextMenu]);

  const handlePaneContextMenu = useCallback((event) => {
    event.preventDefault();
  }, []);

  const nodeColor = useCallback((node) => {
    if (node.data?.nodeType === 'start') return '#777777';
    return node.data?.isSelected ? '#a0a0a0' : '#686868';
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
      onNodeContextMenu={handleNodeContextMenu}
      onPaneContextMenu={handlePaneContextMenu}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      nodesDraggable={false}
      panOnDrag={[0, 1, 2]}
      selectionOnDrag={false}
      zoomOnDoubleClick={false}
      nodeDragThreshold={5}
      minZoom={0.1}
      maxZoom={2}
      attributionPosition="bottom-left"
      proOptions={{ hideAttribution: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Controls
        showZoom={true}
        showFitView={true}
        showInteractive={false}
        position="bottom-right"
      />

      {showMiniMap && (
        <MiniMap
          className={IS_EMBEDDED ? 'cg-minimap embedded' : 'cg-minimap'}
          style={
            IS_EMBEDDED
              ? { width: 140, height: 105 }
              : {
                  width: 160,
                  height: 120,
                  transform: `translate(${miniMapOffset.x}px, ${miniMapOffset.y}px)`
                }
          }
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

function ConversationGraph({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  showMiniMap = !IS_EMBEDDED
}) {
  const containerRef = useRef(null);

  return (
    <div ref={containerRef} className="graph-container">
      <ReactFlowProvider>
        <GraphContent
          qaTree={qaTree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          graphContainerRef={containerRef}
          showMiniMap={showMiniMap}
        />
      </ReactFlowProvider>
    </div>
  );
}

export default ConversationGraph;
