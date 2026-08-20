import dagre from 'dagre';

export const GRAPH_NODE_WIDTH = 216;
export const GRAPH_NODE_HEIGHT = 86;
export const INLINE_ANSWER_WIDTH = 190;
export const INLINE_ANSWER_HEIGHT = 42;

const START_NODE_WIDTH = 92;
const START_NODE_HEIGHT = 34;

function flowNodeMessageId(flowNodeId) {
  if (!flowNodeId || flowNodeId === 'start-node') return null;
  return flowNodeId.replace(/^[qa]-/, '');
}

function makeEdge(source, target, selectedPath, extraClass = '') {
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
    className: [
      'cg-edge',
      onPath ? 'cg-edge-on-path' : '',
      extraClass
    ].filter(Boolean).join(' ')
  };
}

function findQuestionNode(qaTree, questionId) {
  const indexed = qaTree?.qNodeMap?.get?.(questionId);
  if (indexed) return indexed;

  const visited = new Set();
  const walk = (question) => {
    if (!question || visited.has(question.userId)) return null;
    visited.add(question.userId);
    if (question.userId === questionId) return question;

    for (const answer of question.answers || []) {
      for (const child of answer.nextQuestions || []) {
        const match = walk(child);
        if (match) return match;
      }
    }
    return null;
  };

  for (const rootQuestion of qaTree?.root?.questions || []) {
    const match = walk(rootQuestion);
    if (match) return match;
  }
  return null;
}

/**
 * Build the stable/base graph. Single-answer assistant turns stay collapsed here
 * regardless of UI expansion state. This makes Dagre positions independent from
 * reveal/hide operations; expanded assistant nodes are inserted afterwards into
 * the already-reserved inter-rank gap.
 */
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
        isExpanded: hasSingleAnswer && expandedQNodes.has(qNode.userId)
      },
      position: { x: 0, y: 0 }
    });

    if (parentFlowNodeId) {
      flowEdges.push(makeEdge(parentFlowNodeId, flowNodeId, selectedPath));
    }

    if (hasSingleAnswer) {
      // Keep the base topology compact and stable. The assistant preview node is
      // inserted after Dagre layout when the user asks to reveal it.
      const answer = qNode.answers[0];
      for (const nextQNode of answer.nextQuestions) {
        processQNode(nextQNode, flowNodeId);
      }
      return;
    }

    for (const answer of qNode.answers) {
      processANode(answer, flowNodeId);
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
      width: isStartNode ? START_NODE_WIDTH : GRAPH_NODE_WIDTH,
      height: isStartNode ? START_NODE_HEIGHT : GRAPH_NODE_HEIGHT
    });
  });

  edges.forEach(edge => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const position = graph.node(node.id);
    const isStartNode = node.data?.nodeType === 'start';
    const width = isStartNode ? START_NODE_WIDTH : GRAPH_NODE_WIDTH;
    const height = isStartNode ? START_NODE_HEIGHT : GRAPH_NODE_HEIGHT;

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

function injectExpandedSingleAnswers(layoutedNodes, layoutedEdges, qaTree, selectedPath, expandedQNodes) {
  if (!expandedQNodes?.size) return { nodes: layoutedNodes, edges: layoutedEdges };

  const nodes = [...layoutedNodes];
  let edges = [...layoutedEdges];
  const nodeById = new Map(nodes.map(node => [node.id, node]));

  for (const questionId of expandedQNodes) {
    const qNode = findQuestionNode(qaTree, questionId);
    if (!qNode || qNode.answers?.length !== 1) continue;

    const answer = qNode.answers[0];
    const questionFlowId = `q-${questionId}`;
    const answerFlowId = `a-${answer.assistantId}`;
    const questionFlowNode = nodeById.get(questionFlowId);
    if (!questionFlowNode || nodeById.has(answerFlowId)) continue;

    const childFlowIds = (answer.nextQuestions || []).map(question => `q-${question.userId}`);
    const childNodes = childFlowIds.map(id => nodeById.get(id)).filter(Boolean);
    const questionBottom = questionFlowNode.position.y + GRAPH_NODE_HEIGHT;

    let answerTop;
    if (childNodes.length > 0) {
      const nearestChildTop = Math.min(...childNodes.map(node => node.position.y));
      const gap = nearestChildTop - questionBottom;
      answerTop = questionBottom + Math.max(4, (gap - INLINE_ANSWER_HEIGHT) / 2);
    } else {
      answerTop = questionBottom + 18;
    }

    const answerNode = {
      id: answerFlowId,
      type: 'qaNode',
      data: {
        nodeType: 'answer',
        nodeId: answer.assistantId,
        content: answer.content,
        preview: answer.preview,
        createTime: answer.createTime,
        isSelected: selectedPath.has(answer.assistantId),
        childCount: answer.nextQuestions?.length || 0,
        messageId: answer.assistantId,
        isInlineExpandedAnswer: true
      },
      position: {
        x: questionFlowNode.position.x + (GRAPH_NODE_WIDTH - INLINE_ANSWER_WIDTH) / 2,
        y: answerTop
      }
    };

    nodes.push(answerNode);
    nodeById.set(answerFlowId, answerNode);

    const childSet = new Set(childFlowIds);
    edges = edges.filter(edge => !(edge.source === questionFlowId && childSet.has(edge.target)));
    edges.push(makeEdge(questionFlowId, answerFlowId, selectedPath, 'cg-edge-inline'));
    for (const childFlowId of childFlowIds) {
      if (nodeById.has(childFlowId)) {
        edges.push(makeEdge(answerFlowId, childFlowId, selectedPath, 'cg-edge-inline'));
      }
    }
  }

  return { nodes, edges };
}

export function buildAndLayoutQATree(qaTree, selectedPath, direction = 'TB', expandedQNodes = new Set()) {
  const { nodes, edges } = buildFlowFromQATree(qaTree, selectedPath, expandedQNodes);
  const layouted = applyDagreLayout(nodes, edges, direction);
  return injectExpandedSingleAnswers(
    layouted.nodes,
    layouted.edges,
    qaTree,
    selectedPath,
    expandedQNodes
  );
}
