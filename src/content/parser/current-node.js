/**
 * Resolve ChatGPT's raw `current_node` to a node that survives graph parsing and
 * assistant-stream normalization.
 */
export function resolveCurrentNodeId(rawCurrentNodeId, nodes, mapping = {}) {
  if (!rawCurrentNodeId || !Array.isArray(nodes) || nodes.length === 0) return null;

  const nodeIds = new Set(nodes.map(node => node.id));
  const streamOwnerByPartId = new Map();

  for (const node of nodes) {
    for (const partId of node.metadata?.stream_part_ids || []) {
      if (!streamOwnerByPartId.has(partId)) streamOwnerByPartId.set(partId, node.id);
    }
  }

  const visited = new Set();
  let currentId = rawCurrentNodeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    if (nodeIds.has(currentId)) return currentId;

    const normalizedOwner = streamOwnerByPartId.get(currentId);
    if (normalizedOwner) return normalizedOwner;

    currentId = mapping[currentId]?.parent || null;
  }

  return null;
}
