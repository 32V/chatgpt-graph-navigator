/**
 * Converts ChatGPT's backend mapping into the normalized user/assistant graph.
 * System and tool intermediary nodes are bypassed while preserving the nearest
 * valid conversation ancestry.
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

const STREAM_METADATA_KEYS = [
  'is_incremental',
  'stream_group_key',
  'stream_group_part_index',
  'stream_group_part_count',
  'is_thinking_preamble_message',
  'turn_exchange_id',
  'timestamp'
];

function pickStreamMetadata(metadata = {}) {
  const picked = {};
  for (const key of STREAM_METADATA_KEYS) {
    if (metadata[key] !== undefined) picked[key] = metadata[key];
  }
  return picked;
}

export function parseMapping(mapping, conversationId) {
  const replyDescendantCache = new Map();

  const hasAnyReplyDescendant = (nodeId, visiting = new Set()) => {
    if (replyDescendantCache.has(nodeId)) return replyDescendantCache.get(nodeId);
    if (visiting.has(nodeId)) return false;

    visiting.add(nodeId);
    const node = mapping[nodeId];
    let found = false;

    for (const childId of node?.children || []) {
      const child = mapping[childId];
      if (!child) continue;

      const role = child.message?.author?.role;
      if (role === NODE_ROLES.USER) continue;
      if (role === NODE_ROLES.ASSISTANT && hasValidContent(child.message?.content)) {
        found = true;
        break;
      }
      if (hasAnyReplyDescendant(childId, visiting)) {
        found = true;
        break;
      }
    }

    visiting.delete(nodeId);
    replyDescendantCache.set(nodeId, found);
    return found;
  };

  const isConversationMessage = (message, nodeId) => {
    if (!message) return false;

    const role = message.author?.role;
    if (role === NODE_ROLES.SYSTEM) return false;
    if (role === NODE_ROLES.USER) return true;
    if (role !== NODE_ROLES.ASSISTANT) return false;

    const contentType = message.content?.content_type;
    if (!contentType || !TOOL_CONTENT_TYPES.has(contentType)) {
      return hasValidContent(message.content);
    }

    return Boolean(
      nodeId &&
      hasValidContent(message.content) &&
      !hasAnyReplyDescendant(nodeId)
    );
  };

  const validityCache = new Map();
  const isValidConversationNode = (nodeId) => {
    if (validityCache.has(nodeId)) return validityCache.get(nodeId);
    const rawNode = mapping[nodeId];
    const valid = Boolean(rawNode?.message && isConversationMessage(rawNode.message, nodeId));
    validityCache.set(nodeId, valid);
    return valid;
  };

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

      if (isValidConversationNode(childId)) result.push(childId);
      else queue.push(...(mapping[childId]?.children || []));
    }

    return result;
  };

  const nodes = [];
  for (const [nodeId, rawNode] of Object.entries(mapping || {})) {
    if (!isValidConversationNode(nodeId)) continue;

    const message = rawNode.message;
    const createTime = Number(message.create_time);
    nodes.push({
      id: nodeId,
      conversationId,
      role: message.author.role,
      content: processContent(message.content),
      createTime: Number.isFinite(createTime) ? createTime : 0,
      parent: findValidAncestor(nodeId),
      children: findValidDescendants(nodeId),
      // Used only to identify native sibling groups when every valid ancestor
      // was filtered from the normalized graph.
      branchParentId: rawNode.parent || null,
      metadata: pickStreamMetadata(message.metadata)
    });
  }

  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edges = [];
  for (const node of nodes) {
    for (const childId of node.children) {
      const child = nodeMap.get(childId);
      if (!child) continue;

      edges.push({
        id: `${conversationId}:${node.id}->${childId}`,
        conversationId,
        source: node.id,
        target: childId,
        sourceRole: node.role,
        targetRole: child.role,
        orderKey: child.createTime || node.createTime || 0
      });
    }
  }

  log('info', 'Parser', `Parsed ${nodes.length} nodes and ${edges.length} edges`);
  return { nodes, edges };
}
