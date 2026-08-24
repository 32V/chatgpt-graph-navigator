/**
 * Pure helpers for canonical branch structure. DOM actuation lives separately in
 * branch-navigator.js so these invariants stay cheap to test.
 */

export function buildPathToTarget(targetId, nodeMap) {
  const path = [];
  const visited = new Set();
  let currentId = targetId;

  while (currentId && nodeMap.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    path.unshift(currentId);
    currentId = nodeMap.get(currentId)?.parent || null;
  }

  return path;
}

export function getSiblings(nodeId, nodeMap) {
  const node = nodeMap.get(nodeId);
  if (!node) return [nodeId];

  if (node.parent) {
    const parent = nodeMap.get(node.parent);
    if (!parent?.children?.length) return [nodeId];
    return parent.children.filter(id => nodeMap.has(id));
  }

  const rawParent = node._rawParent || null;
  return Array.from(nodeMap.values())
    .filter(candidate =>
      !candidate.parent &&
      (rawParent ? candidate._rawParent === rawParent : true)
    )
    .sort((a, b) => {
      const timeDiff = (a.createTime || 0) - (b.createTime || 0);
      return timeDiff || String(a.id).localeCompare(String(b.id));
    })
    .map(candidate => candidate.id);
}

export function buildDepthMap(nodes) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const cache = new Map();

  const depthOf = (id, visiting = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const parentId = nodeMap.get(id)?.parent;
    const depth = parentId && nodeMap.has(parentId)
      ? depthOf(parentId, visiting) + 1
      : 0;

    visiting.delete(id);
    cache.set(id, depth);
    return depth;
  };

  for (const node of nodes) depthOf(node.id);
  return cache;
}
