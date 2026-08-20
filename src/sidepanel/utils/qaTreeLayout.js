import dagre from 'dagre';

const NODE_WIDTH = 216;
const NODE_HEIGHT = 86;
const START_NODE_WIDTH = 92;
const START_NODE_HEIGHT = 34;

function flowNodeMessageId(flowNodeId) {
  if (!flowNodeId || flowNodeId === 'start-node') return null;
  return flowNodeId.replace(/^[qa]-/, '');
}

function makeEdge(source, target, selectedPath) {
  const sourceMessageId = flowNodeMessageId(source);
  const targetMessageId = flowNodeMessageId(target);
  const onPath = Boolean(
    targetMessageId &&
    selectedPath.has(targetMessageId) &&
    (!sourceMessageId || selectedPath.has(sourceMessageId))
  );

  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    className: onPath ? 'cg-edge cg-edge-on-path' : 'cg-edge'
  };
}

export function buildFlowFromQATree(qaTree, selectedPath = new Set(), expandedQNodes = new Set()) {
  if (!qaTree || !qaTree.root || qaTree.root.questions.length === 0) {
    return { nodes: [], edges: [] };
  }

  const flowNodes = [];
  const flowEdges = [];
  const hasMultipleRoots = qaTree.root.questions.length > 1;

  if (hasMultipleRoots) {
    flowNodes.push({
      id: 'start-node',
      type: 'startNode',
      data: { nodeType: 'start' },
      position: { x: 0, y: 0 }
    });
  }

  function processQNode(qNode, parentFlowNodeId = null) {
    const isSelected = selectedPath.has(qNode.userId);
    const flowNodeId = `q-${qNode.userId}`;
    const hasSingleAnswer = qNode.answers.length === 1;
    const isExpanded = expandedQNodes.has(qNode.userId);
    const shouldCollapseAnswer = hasSingleAnswer && !isExpanded;
    const collapsedAnswer = hasSingleAnswer ? qNode.answers[0] : null;

    flowNodes.push({
      id: flowNodeId,
      type: 'qaNode',
      data: {
        nodeType: 'question',
        nodeId: qNode.userId,
        content: qNode.content,
        preview: qNode.preview,
        createTime: qNode.createTime,
        isSelected,
        childCount: qNode.answers.length,
        messageId: qNode.userId,
        collapsedAnswer: collapsedAnswer ? {
          assistantId: collapsedAnswer.assistantId,
          content: collapsedAnswer.content,
          preview: collapsedAnswer.preview
        } : null,
        canExpand: hasSingleAnswer,
        isExpanded
      },
      position: { x: 0, y: 0 }
    });

    if (parentFlowNodeId) {
      flowEdges.push(makeEdge(parentFlowNodeId, flowNodeId, selectedPath));
    }

    if (shouldCollapseAnswer) {
      const answer = qNode.answers[0];
      for (const nextQNode of answer.nextQuestions) {
        processQNode(nextQNode, flowNodeId);
      }
    } else {
      for (const answer of qNode.answers) {
        processANode(answer, flowNodeId);
      }
    }
  }

  function processANode(aNode, parentFlowNodeId) {
    const isSelected = selectedPath.has(aNode.assistantId);
    const flowNodeId = `a-${aNode.assistantId}`;

    flowNodes.push({
      id: flowNodeId,
      type: 'qaNode',
      data: {
        nodeType: 'answer',
        nodeId: aNode.assistantId,
        content: aNode.content,
        preview: aNode.preview,
        createTime: aNode.createTime,
        isSelected,
        childCount: aNode.nextQuestions.length,
        messageId: aNode.assistantId
      },
      position: { x: 0, y: 0 }
    });

    flowEdges.push(makeEdge(parentFlowNodeId, flowNodeId, selectedPath));

    for (const qNode of aNode.nextQuestions) {
      processQNode(qNode, flowNodeId);
    }
  }

  for (const qNode of qaTree.root.questions) {
    processQNode(qNode, hasMultipleRoots ? 'start-node' : null);
  }

  return { nodes: flowNodes, edges: flowEdges };
}

export function applyDagreLayout(nodes, edges, direction = 'TB') {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 30,
    ranksep: 54,
    marginx: 28,
    marginy: 28
  });

  nodes.forEach((node) => {
    const isStartNode = node.data?.nodeType === 'start';
    graph.setNode(node.id, {
      width: isStartNode ? START_NODE_WIDTH : NODE_WIDTH,
      height: isStartNode ? START_NODE_HEIGHT : NODE_HEIGHT
    });
  });

  edges.forEach(edge => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const position = graph.node(node.id);
    const isStartNode = node.data?.nodeType === 'start';
    const width = isStartNode ? START_NODE_WIDTH : NODE_WIDTH;
    const height = isStartNode ? START_NODE_HEIGHT : NODE_HEIGHT;

    return {
      ...node,
      position: {
        x: position.x - width / 2,
        y: position.y - height / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function buildAndLayoutQATree(qaTree, selectedPath, direction = 'TB', expandedQNodes = new Set()) {
  const { nodes, edges } = buildFlowFromQATree(qaTree, selectedPath, expandedQNodes);
  return applyDagreLayout(nodes, edges, direction);
}
