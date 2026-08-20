









const PREVIEW_LENGTH = 80;


function truncate(text, maxLength = PREVIEW_LENGTH) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '…';
}


function sortByTimeOrId(a, b) {
  const timeA = a.createTime;
  const timeB = b.createTime;

  
  if (timeA != null && timeB != null) {
    return timeA - timeB;
  }

  
  if (timeA != null) return -1;
  if (timeB != null) return 1;

  
  const idA = a.userId || a.assistantId || a.key || '';
  const idB = b.userId || b.assistantId || b.key || '';
  return idA.localeCompare(idB);
}


function sortQATreeRecursively(questions) {
  if (!questions || questions.length === 0) return;

  questions.sort(sortByTimeOrId);

  for (const qNode of questions) {
    if (qNode.answers && qNode.answers.length > 0) {
      qNode.answers.sort(sortByTimeOrId);

      for (const aNode of qNode.answers) {
        if (aNode.nextQuestions && aNode.nextQuestions.length > 0) {
          sortQATreeRecursively(aNode.nextQuestions);
        }
      }
    }
  }
}


export function buildQATree(nodes, edges) {
  if (!nodes || nodes.length === 0) {
    return createEmptyTree();
  }

  
  const rawNodeMap = new Map(nodes.map(n => [n.id, n]));

  
  
  const parentMap = new Map();    // nodeId -> parentNodeId
  const childrenMap = new Map();  // nodeId -> [childNodeId, ...]

  
  for (const node of nodes) {
    if (node.parent) {
      parentMap.set(node.id, node.parent);
    }
    
    if (node.children && node.children.length > 0) {
      childrenMap.set(node.id, [...node.children]);
    }
  }

  
  for (const edge of edges) {
    parentMap.set(edge.target, edge.source);

    if (!childrenMap.has(edge.source)) {
      childrenMap.set(edge.source, []);
    }
    const children = childrenMap.get(edge.source);
    if (!children.includes(edge.target)) {
      children.push(edge.target);
    }
  }

  
  const qNodeMap = new Map();  // userId -> QNode
  const aNodeMap = new Map();  // assistantId -> ANode

  
  function findAncestorAssistant(nodeId) {
    let current = parentMap.get(nodeId);
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      const node = rawNodeMap.get(current);
      if (node && node.role === 'assistant') {
        return current;
      }
      current = parentMap.get(current);
    }
    return null;
  }

  
  function findAncestorUser(nodeId) {
    let current = parentMap.get(nodeId);
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      const node = rawNodeMap.get(current);
      if (node && node.role === 'user') {
        return current;
      }
      current = parentMap.get(current);
    }
    return null;
  }

  
  for (const node of nodes) {
    if (node.role !== 'user') continue;

    
    const parentAssistantId = findAncestorAssistant(node.id) || 'root';

    const qNode = {
      type: 'Q',
      key: `${node.id}::${parentAssistantId}`,
      userId: node.id,
      content: node.content || '',
      preview: truncate(node.content),
      createTime: node.createTime || null,
      answers: []
    };

    qNodeMap.set(node.id, qNode);
  }

  
  for (const node of nodes) {
    if (node.role !== 'assistant') continue;

    
    const parentUserId = findAncestorUser(node.id) || 'unknown';

    const aNode = {
      type: 'A',
      key: `${node.id}::${parentUserId}`,
      assistantId: node.id,
      content: node.content || '',
      preview: truncate(node.content),
      createTime: node.createTime || null,
      nextQuestions: []
    };

    aNodeMap.set(node.id, aNode);
  }

  
  
  for (const node of nodes) {
    if (node.role !== 'assistant') continue;

    const parentUserId = findAncestorUser(node.id);
    if (!parentUserId) continue;

    const qNode = qNodeMap.get(parentUserId);
    const aNode = aNodeMap.get(node.id);
    if (qNode && aNode && !qNode.answers.includes(aNode)) {
      qNode.answers.push(aNode);
    }
  }

  
  
  for (const node of nodes) {
    if (node.role !== 'user') continue;

    const parentAssistantId = findAncestorAssistant(node.id);
    if (!parentAssistantId) continue;  // root level question

    const aNode = aNodeMap.get(parentAssistantId);
    const qNode = qNodeMap.get(node.id);
    if (aNode && qNode && !aNode.nextQuestions.includes(qNode)) {
      aNode.nextQuestions.push(qNode);
    }
  }

  
  const rootQuestions = [];
  for (const node of nodes) {
    if (node.role !== 'user') continue;

    const parentAssistantId = findAncestorAssistant(node.id);

    if (!parentAssistantId) {
      const qNode = qNodeMap.get(node.id);
      if (qNode) {
        rootQuestions.push(qNode);
      }
    }
  }

  
  sortQATreeRecursively(rootQuestions);

  
  const root = {
    type: 'root',
    questions: rootQuestions
  };

  
  const { selectedPath, activeLeafId } = computeDefaultSelectedPath(root, qNodeMap, aNodeMap);

  return {
    root,
    qNodeMap,
    aNodeMap,
    parentMap,
    childrenMap,
    selectedPath,
    activeLeafId
  };
}


function createEmptyTree() {
  return {
    root: { type: 'root', questions: [] },
    qNodeMap: new Map(),
    aNodeMap: new Map(),
    parentMap: new Map(),
    childrenMap: new Map(),
    selectedPath: new Set(),
    activeLeafId: null
  };
}


function computeDefaultSelectedPath(root, qNodeMap, aNodeMap) {
  const selectedPath = new Set();
  let activeLeafId = null;

  if (!root.questions || root.questions.length === 0) {
    return { selectedPath, activeLeafId };
  }

  
  let currentQ = root.questions[root.questions.length - 1];

  while (currentQ) {
    selectedPath.add(currentQ.userId);
    activeLeafId = currentQ.userId;

    
    if (!currentQ.answers || currentQ.answers.length === 0) {
      break;
    }

    
    const currentA = currentQ.answers[currentQ.answers.length - 1];
    selectedPath.add(currentA.assistantId);
    activeLeafId = currentA.assistantId;

    
    if (!currentA.nextQuestions || currentA.nextQuestions.length === 0) {
      break;
    }

    
    currentQ = currentA.nextQuestions[currentA.nextQuestions.length - 1];
  }

  return { selectedPath, activeLeafId };
}


export function computePathFromNode(nodeId, parentMap) {
  const path = new Set();

  let current = nodeId;
  while (current) {
    path.add(current);
    current = parentMap.get(current);
  }

  return path;
}


export function updateSelectedPath(tree, newActiveNodeId) {
  const newSelectedPath = computePathFromNode(newActiveNodeId, tree.parentMap);

  return {
    ...tree,
    selectedPath: newSelectedPath,
    activeLeafId: newActiveNodeId
  };
}


export function isOnSelectedPath(nodeId, selectedPath) {
  return selectedPath.has(nodeId);
}


export function getSiblingInfo(nodeId, tree) {
  const { qNodeMap, aNodeMap, parentMap, childrenMap } = tree;

  const parentId = parentMap.get(nodeId);
  if (!parentId) {
    
    const qNode = qNodeMap.get(nodeId);
    if (qNode && tree.root.questions.length > 1) {
      const siblings = tree.root.questions.map(q => q.userId);
      const index = siblings.indexOf(nodeId);
      return {
        index: index >= 0 ? index : 0,
        total: siblings.length,
        siblings
      };
    }
    return null;
  }

  
  const siblings = childrenMap.get(parentId) || [];
  if (siblings.length <= 1) {
    return null; 
  }

  const index = siblings.indexOf(nodeId);
  return {
    index: index >= 0 ? index : 0,
    total: siblings.length,
    siblings
  };
}


export function switchToSibling(currentNodeId, direction, tree) {
  const siblingInfo = getSiblingInfo(currentNodeId, tree);
  if (!siblingInfo || siblingInfo.total <= 1) {
    return null;
  }

  const { index, siblings } = siblingInfo;
  let newIndex;

  if (direction === 'prev') {
    newIndex = index > 0 ? index - 1 : siblings.length - 1;
  } else {
    newIndex = index < siblings.length - 1 ? index + 1 : 0;
  }

  const newNodeId = siblings[newIndex];
  if (!newNodeId || newNodeId === currentNodeId) {
    return null;
  }

  
  const newLeafId = findDeepestLeaf(newNodeId, tree);

  return updateSelectedPath(tree, newLeafId);
}


function findDeepestLeaf(startNodeId, tree) {
  const { qNodeMap, aNodeMap, childrenMap } = tree;

  let currentId = startNodeId;
  let visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const children = childrenMap.get(currentId) || [];
    if (children.length === 0) {
      
      return currentId;
    }

    
    
    const qNode = qNodeMap.get(currentId);
    const aNode = aNodeMap.get(currentId);

    if (qNode && qNode.answers.length > 0) {
      
      currentId = qNode.answers[qNode.answers.length - 1].assistantId;
    } else if (aNode && aNode.nextQuestions.length > 0) {
      
      currentId = aNode.nextQuestions[aNode.nextQuestions.length - 1].userId;
    } else {
      
      return currentId;
    }
  }

  return currentId;
}


export function getTreeStats(tree) {
  const { qNodeMap, aNodeMap, root } = tree;

  
  let branchPointsQ = 0;  
  let branchPointsA = 0;  

  for (const qNode of qNodeMap.values()) {
    if (qNode.answers.length > 1) {
      branchPointsQ++;
    }
  }

  for (const aNode of aNodeMap.values()) {
    if (aNode.nextQuestions.length > 1) {
      branchPointsA++;
    }
  }

  
  const depth = computeTreeDepth(root);

  return {
    totalQuestions: qNodeMap.size,
    totalAnswers: aNodeMap.size,
    rootQuestions: root.questions.length,
    branchPointsQ,  
    branchPointsA,  
    totalBranchPoints: branchPointsQ + branchPointsA,
    maxDepth: depth
  };
}


function computeTreeDepth(root) {
  if (!root.questions || root.questions.length === 0) {
    return 0;
  }

  function depthOfQ(qNode) {
    if (!qNode.answers || qNode.answers.length === 0) {
      return 1;
    }
    return 1 + Math.max(...qNode.answers.map(depthOfA));
  }

  function depthOfA(aNode) {
    if (!aNode.nextQuestions || aNode.nextQuestions.length === 0) {
      return 1;
    }
    return 1 + Math.max(...aNode.nextQuestions.map(depthOfQ));
  }

  return Math.max(...root.questions.map(depthOfQ));
}


export function traverseTree(tree, callback) {
  const { root } = tree;

  function traverseQ(qNode, depth) {
    callback(qNode, 'Q', depth);
    for (const aNode of qNode.answers) {
      traverseA(aNode, depth + 1);
    }
  }

  function traverseA(aNode, depth) {
    callback(aNode, 'A', depth);
    for (const qNode of aNode.nextQuestions) {
      traverseQ(qNode, depth + 1);
    }
  }

  for (const qNode of root.questions) {
    traverseQ(qNode, 0);
  }
}


export function getSelectedPathAsList(tree) {
  const { root, selectedPath } = tree;
  const result = [];

  function collectFromQ(qNode, depth) {
    if (!selectedPath.has(qNode.userId)) return;

    result.push({ type: 'Q', node: qNode, depth });

    
    for (const aNode of qNode.answers) {
      if (selectedPath.has(aNode.assistantId)) {
        collectFromA(aNode, depth);
        break;
      }
    }
  }

  function collectFromA(aNode, depth) {
    result.push({ type: 'A', node: aNode, depth });

    
    for (const qNode of aNode.nextQuestions) {
      if (selectedPath.has(qNode.userId)) {
        collectFromQ(qNode, depth + 1);
        break;
      }
    }
  }

  
  for (const qNode of root.questions) {
    if (selectedPath.has(qNode.userId)) {
      collectFromQ(qNode, 0);
      break;
    }
  }

  return result;
}


export function debugPrintTree(tree) {
  const { root, selectedPath, qNodeMap, aNodeMap, parentMap, childrenMap } = tree;
  const stats = getTreeStats(tree);

  const lines = [];
  lines.push('========== QA Tree ==========');
  lines.push(`Stats: Q=${stats.totalQuestions} A=${stats.totalAnswers} rootQ=${stats.rootQuestions} branchQ=${stats.branchPointsQ} branchA=${stats.branchPointsA} depth=${stats.maxDepth}`);
  lines.push(`ActiveLeaf: ${tree.activeLeafId || '(none)'}`);
  lines.push(`SelectedPath (${selectedPath.size}): ${Array.from(selectedPath).map(id => id.substring(0, 8)).join(' → ')}`);
  lines.push('');

  
  lines.push(`--- parentMap (${parentMap.size} entries) ---`);
  for (const [child, parent] of parentMap) {
    const childNode = qNodeMap.get(child) || aNodeMap.get(child);
    const parentNode = qNodeMap.get(parent) || aNodeMap.get(parent);
    const childRole = childNode ? (childNode.type === 'Q' ? 'Q' : 'A') : '?';
    const parentRole = parentNode ? (parentNode.type === 'Q' ? 'Q' : 'A') : '?';
    lines.push(`  ${childRole}:${child.substring(0, 8)} ← ${parentRole}:${parent.substring(0, 8)}`);
  }
  lines.push('');

  
  lines.push('--- Tree Structure ---');
  lines.push(`Root questions: ${root.questions.length}`);

  function printQ(qNode, indent) {
    const sel = selectedPath.has(qNode.userId) ? '✓' : ' ';
    const id = qNode.userId.substring(0, 8);
    const preview = (qNode.preview || '(empty)').substring(0, 50);
    lines.push(`${indent}[${sel}] Q(${id}) "${preview}" → ${qNode.answers.length} answers`);
    for (let i = 0; i < qNode.answers.length; i++) {
      printA(qNode.answers[i], indent + '│ ', i === qNode.answers.length - 1);
    }
  }

  function printA(aNode, indent, isLast) {
    const sel = selectedPath.has(aNode.assistantId) ? '✓' : ' ';
    const id = aNode.assistantId.substring(0, 8);
    const preview = (aNode.preview || '(empty)').substring(0, 50);
    const connector = isLast ? '└─' : '├─';
    lines.push(`${indent}${connector}[${sel}] A(${id}) "${preview}" → ${aNode.nextQuestions.length} next`);
    const childIndent = indent + (isLast ? '  ' : '│ ');
    for (const qNode of aNode.nextQuestions) {
      printQ(qNode, childIndent);
    }
  }

  for (const qNode of root.questions) {
    printQ(qNode, '  ');
  }

  
  const treeQIds = new Set();
  const treeAIds = new Set();
  traverseTree(tree, (node, type) => {
    if (type === 'Q') treeQIds.add(node.userId);
    else treeAIds.add(node.assistantId);
  });

  const orphanQ = [...qNodeMap.keys()].filter(id => !treeQIds.has(id));
  const orphanA = [...aNodeMap.keys()].filter(id => !treeAIds.has(id));

  if (orphanQ.length > 0 || orphanA.length > 0) {
    lines.push('');
    lines.push(`--- Orphan Nodes (not in tree!) ---`);
    for (const id of orphanQ) {
      const q = qNodeMap.get(id);
      const parentId = parentMap.get(id);
      lines.push(`  Q(${id.substring(0, 8)}) parent=${parentId?.substring(0, 8) || 'none'} "${(q.preview || '').substring(0, 40)}"`);
    }
    for (const id of orphanA) {
      const a = aNodeMap.get(id);
      const parentId = parentMap.get(id);
      lines.push(`  A(${id.substring(0, 8)}) parent=${parentId?.substring(0, 8) || 'none'} "${(a.preview || '').substring(0, 40)}"`);
    }
  }

  lines.push('=============================');

  
  console.log(lines.join('\n'));
}
