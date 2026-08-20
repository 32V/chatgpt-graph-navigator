import { log } from '../../shared/utils.js';
import { buildNodeMap, getPathToRoot } from './mapping-parser.js';

export function findBranchPoints(nodes) {
  const branchPoints = [];

  for (const node of nodes) {
    if (node.children?.length > 1) {
      branchPoints.push({
        nodeId: node.id,
        role: node.role,
        content: `${node.content.substring(0, 60)}...`,
        childrenCount: node.children.length,
        childrenIds: node.children
      });
    }
  }

  log('info', 'BranchExtractor', `Found ${branchPoints.length} branch points`);
  return branchPoints;
}

export function findLeafNodes(nodes) {
  return nodes.filter(node => !node.children?.length);
}

export function extractBranches(nodes) {
  const nodeMap = buildNodeMap(nodes);
  const branches = findLeafNodes(nodes).map((leafNode) => {
    const path = getPathToRoot(leafNode.id, nodeMap);
    return {
      id: leafNode.id,
      path,
      messageCount: path.length,
      depth: path.length
    };
  });

  log('info', 'BranchExtractor', `Extracted ${branches.length} branches`);
  return branches;
}

/**
 * Builds user-centric rounds for the timeline view.
 * A round is one user message plus its first direct assistant child, if any.
 */
export function buildRounds(nodes) {
  if (!nodes?.length) return [];

  const nodeMap = buildNodeMap(nodes);
  const userNodes = nodes
    .filter(node => node.role === 'user')
    .slice()
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  const rounds = userNodes.map((userNode, index) => {
    const assistantNode = (userNode.children || [])
      .map(childId => nodeMap.get(childId))
      .find(child => child?.role === 'assistant') || null;

    return {
      id: `round_${userNode.id}`,
      conversationId: userNode.conversationId,
      roundNumber: index + 1,
      depth: 0,
      userMessage: {
        id: userNode.id,
        role: 'user',
        content: userNode.content || '',
        createTime: userNode.createTime
      },
      assistantMessage: assistantNode ? {
        id: assistantNode.id,
        role: 'assistant',
        content: assistantNode.content || '',
        createTime: assistantNode.createTime
      } : null,
      userMessageId: userNode.id,
      assistantMessageId: assistantNode?.id || null,
      parentRoundId: null,
      createTime: userNode.createTime
    };
  });

  const userToRoundId = new Map();
  const assistantToRoundId = new Map();
  const roundById = new Map();

  rounds.forEach((round) => {
    roundById.set(round.id, round);
    if (round.userMessageId) userToRoundId.set(round.userMessageId, round.id);
    if (round.assistantMessageId) assistantToRoundId.set(round.assistantMessageId, round.id);
  });

  for (const round of rounds) {
    const userNode = nodeMap.get(round.userMessageId);
    if (!userNode?.parent) continue;

    const parentNode = nodeMap.get(userNode.parent);
    if (!parentNode) continue;

    if (parentNode.role === 'assistant') {
      round.parentRoundId = assistantToRoundId.get(parentNode.id) || null;
    } else if (parentNode.role === 'user') {
      round.parentRoundId = userToRoundId.get(parentNode.id) || null;
    }
  }

  const depthMemo = new Map();
  const visiting = new Set();

  const computeDepth = (roundId) => {
    if (!roundId) return 0;
    if (depthMemo.has(roundId)) return depthMemo.get(roundId);
    if (visiting.has(roundId)) return 0;

    visiting.add(roundId);
    const round = roundById.get(roundId);
    const depth = round?.parentRoundId ? computeDepth(round.parentRoundId) + 1 : 0;
    depthMemo.set(roundId, depth);
    visiting.delete(roundId);
    return depth;
  };

  rounds.forEach((round) => {
    round.depth = computeDepth(round.id);
  });

  log('info', 'BranchExtractor', `Built ${rounds.length} rounds`);
  return rounds;
}

export function analyzeBranchStructure(nodes) {
  const branchPoints = findBranchPoints(nodes);
  const branches = extractBranches(nodes);
  const leafNodes = findLeafNodes(nodes);

  return {
    totalNodes: nodes.length,
    branchPointsCount: branchPoints.length,
    branchesCount: branches.length,
    leafNodesCount: leafNodes.length,
    branchPoints,
    branches,
    leafNodes
  };
}

export function getSiblings(nodeId, nodes) {
  const nodeMap = buildNodeMap(nodes);
  const node = nodeMap.get(nodeId);
  if (!node?.parent) return [];

  const parent = nodeMap.get(node.parent);
  if (!parent) return [];

  return parent.children
    .filter(childId => childId !== nodeId)
    .map(childId => nodeMap.get(childId))
    .filter(Boolean);
}
