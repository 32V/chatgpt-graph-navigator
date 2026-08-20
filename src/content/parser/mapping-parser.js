/**
 * Converts ChatGPT's backend mapping into the normalized graph used by the
 * extension. Tool/system intermediary nodes are bypassed while preserving the
 * nearest valid conversation ancestry.
 */

import { NODE_ROLES } from '../../shared/constants.js';
import { log } from '../../shared/utils.js';
import { processContent, hasValidContent } from './content-processor.js';

const TOOL_CONTENT_TYPES = new Set([
  'code',
  'execution_output',
  'tether_browsing_display',
  'tether_quote',
  'system_error',
  'model_editable_context'
]);

export function parseMapping(mapping, conversationId) {
  const hasAnyReplyDescendant = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);

    const node = mapping[nodeId];
    if (!node) return false;

    for (const childId of node.children || []) {
      const child = mapping[childId];
      if (!child) continue;

      const role = child.message?.author?.role;
      if (role === NODE_ROLES.USER) continue;
      if (role === NODE_ROLES.ASSISTANT && hasValidContent(child.message?.content)) {
        return true;
      }
      if (hasAnyReplyDescendant(childId, visited)) return true;
    }

    return false;
  };

  const shouldKeepAsLastReply = (nodeId) => {
    const node = mapping[nodeId];
    return Boolean(
      node?.message &&
      hasValidContent(node.message.content) &&
      !hasAnyReplyDescendant(nodeId)
    );
  };

  const isConversationMessage = (message, nodeId = null) => {
    if (!message) return false;

    const role = message.author?.role;
    const contentType = message.content?.content_type;

    if (role === NODE_ROLES.SYSTEM) return false;
    if (role === NODE_ROLES.USER) return true;
    if (role !== NODE_ROLES.ASSISTANT) return false;

    if (!contentType || !TOOL_CONTENT_TYPES.has(contentType)) {
      return hasValidContent(message.content);
    }

    return Boolean(nodeId && shouldKeepAsLastReply(nodeId));
  };

  const isValidConversationNode = nodeId => Boolean(
    mapping[nodeId]?.message && isConversationMessage(mapping[nodeId].message, nodeId)
  );

  const findValidAncestor = (nodeId) => {
    let current = mapping[nodeId]?.parent;
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      if (isValidConversationNode(current)) return current;
      current = mapping[current]?.parent;
    }
    return null;
  };

  const findValidDescendants = (nodeId) => {
    const result = [];
    const queue = [...(mapping[nodeId]?.children || [])];
    const visited = new Set();

    while (queue.length > 0) {
      const childId = queue.shift();
      if (visited.has(childId)) continue;
      visited.add(childId);

      if (isValidConversationNode(childId)) {
        result.push(childId);
      } else {
        queue.push(...(mapping[childId]?.children || []));
      }
    }

    return result;
  };

  const nodes = [];

  for (const nodeId in mapping) {
    const rawNode = mapping[nodeId];
    if (!rawNode.message || !isConversationMessage(rawNode.message, nodeId)) continue;

    nodes.push({
      id: nodeId,
      conversationId,
      role: rawNode.message.author.role,
      content: processContent(rawNode.message.content) || '',
      createTime: rawNode.message.create_time || Date.now() / 1000,
      parent: findValidAncestor(nodeId),
      children: findValidDescendants(nodeId),
      _rawParent: rawNode.parent || null,
      _rawChildren: rawNode.children || [],
      metadata: {
        status: rawNode.message.status,
        weight: rawNode.message.weight,
        endTurn: rawNode.message.end_turn,
        ...rawNode.message.metadata
      }
    });
  }

  const validNodeIds = new Set(nodes.map(node => node.id));
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edges = [];

  for (const node of nodes) {
    for (const childId of node.children) {
      if (!validNodeIds.has(childId)) continue;
      const child = nodeMap.get(childId);
      if (!child) continue;

      edges.push({
        id: `${conversationId}:${node.id}->${childId}`,
        conversationId,
        source: node.id,
        target: childId,
        sourceRole: node.role,
        targetRole: child.role,
        orderKey: child.createTime || node.createTime || Date.now() / 1000
      });
    }
  }

  log('info', 'Parser', `Parsed ${nodes.length} nodes and ${edges.length} edges`);
  return { nodes, edges };
}

export function buildNodeMap(nodes) {
  return new Map(nodes.map(node => [node.id, node]));
}

export function findRootNode(nodes) {
  return nodes.find(node => node.role === NODE_ROLES.USER && !node.parent) || null;
}

export function getAncestors(nodeId, nodeMap) {
  const ancestors = [];
  const visited = new Set();
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (node.parent) {
      const parent = nodeMap.get(node.parent);
      if (parent) ancestors.unshift(parent);
    }
    currentId = node.parent;
  }

  return ancestors;
}

export function getDescendants(nodeId, nodeMap) {
  const descendants = [];
  const queue = [nodeId];
  const visited = new Set();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const node = nodeMap.get(currentId);
    if (!node) continue;

    for (const childId of node.children) {
      const child = nodeMap.get(childId);
      if (!child) continue;
      descendants.push(child);
      queue.push(childId);
    }
  }

  return descendants;
}

export function getPathToRoot(nodeId, nodeMap) {
  const path = [];
  const visited = new Set();
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    path.unshift(node);
    currentId = node.parent;
  }

  return path;
}

export function getNodeStatistics(nodes) {
  const stats = {
    total: nodes.length,
    user: 0,
    assistant: 0,
    tool: 0,
    maxDepth: 0,
    branchPoints: 0
  };

  for (const node of nodes) {
    if (node.role === NODE_ROLES.USER) stats.user += 1;
    else if (node.role === NODE_ROLES.ASSISTANT) stats.assistant += 1;
    else if (node.role === 'tool') stats.tool += 1;

    if (node.children.length > 1) stats.branchPoints += 1;
  }

  return stats;
}
