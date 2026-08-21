const PREVIEW_LENGTH = 80;

function preview(text) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= PREVIEW_LENGTH
    ? normalized
    : `${normalized.slice(0, PREVIEW_LENGTH)}…`;
}

function sortByTimeOrId(a, b) {
  const timeA = a.createTime;
  const timeB = b.createTime;

  if (timeA != null && timeB != null) return timeA - timeB;
  if (timeA != null) return -1;
  if (timeB != null) return 1;

  const idA = a.userId || a.assistantId || '';
  const idB = b.userId || b.assistantId || '';
  return idA.localeCompare(idB);
}

function sortTree(questions) {
  questions.sort(sortByTimeOrId);
  for (const question of questions) {
    question.answers.sort(sortByTimeOrId);
    for (const answer of question.answers) sortTree(answer.nextQuestions);
  }
}

function emptyTree() {
  return {
    root: { type: 'root', questions: [] },
    qNodeMap: new Map(),
    aNodeMap: new Map(),
    parentMap: new Map(),
    selectedPath: new Set(),
    activeLeafId: null
  };
}

function defaultSelectedPath(root) {
  const selectedPath = new Set();
  let activeLeafId = null;
  let question = root.questions.at(-1) || null;

  while (question) {
    selectedPath.add(question.userId);
    activeLeafId = question.userId;

    const answer = question.answers.at(-1) || null;
    if (!answer) break;

    selectedPath.add(answer.assistantId);
    activeLeafId = answer.assistantId;
    question = answer.nextQuestions.at(-1) || null;
  }

  return { selectedPath, activeLeafId };
}

/**
 * Convert normalized user/assistant graph nodes into the alternating QA tree
 * consumed by both panel views.
 */
export function buildQATree(nodes, edges = []) {
  if (!nodes?.length) return emptyTree();

  const rawNodeMap = new Map(nodes.map(node => [node.id, node]));
  const parentMap = new Map();

  for (const node of nodes) {
    if (node.parent) parentMap.set(node.id, node.parent);
  }
  for (const edge of edges || []) {
    if (edge?.target && edge?.source) parentMap.set(edge.target, edge.source);
  }

  const findAncestorByRole = (nodeId, role) => {
    let currentId = parentMap.get(nodeId);
    const visited = new Set();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = rawNodeMap.get(currentId);
      if (node?.role === role) return currentId;
      currentId = parentMap.get(currentId);
    }
    return null;
  };

  const qNodeMap = new Map();
  const aNodeMap = new Map();

  for (const node of nodes) {
    if (node.role === 'user') {
      qNodeMap.set(node.id, {
        type: 'Q',
        key: `${node.id}::${findAncestorByRole(node.id, 'assistant') || 'root'}`,
        userId: node.id,
        content: node.content || '',
        preview: preview(node.content),
        createTime: node.createTime ?? null,
        answers: []
      });
    } else if (node.role === 'assistant') {
      aNodeMap.set(node.id, {
        type: 'A',
        key: `${node.id}::${findAncestorByRole(node.id, 'user') || 'unknown'}`,
        assistantId: node.id,
        content: node.content || '',
        preview: preview(node.content),
        createTime: node.createTime ?? null,
        nextQuestions: []
      });
    }
  }

  for (const node of nodes) {
    if (node.role === 'assistant') {
      const question = qNodeMap.get(findAncestorByRole(node.id, 'user'));
      const answer = aNodeMap.get(node.id);
      if (question && answer && !question.answers.includes(answer)) question.answers.push(answer);
    } else if (node.role === 'user') {
      const answer = aNodeMap.get(findAncestorByRole(node.id, 'assistant'));
      const question = qNodeMap.get(node.id);
      if (answer && question && !answer.nextQuestions.includes(question)) {
        answer.nextQuestions.push(question);
      }
    }
  }

  const rootQuestions = nodes
    .filter(node => node.role === 'user' && !findAncestorByRole(node.id, 'assistant'))
    .map(node => qNodeMap.get(node.id))
    .filter(Boolean);

  sortTree(rootQuestions);
  const root = { type: 'root', questions: rootQuestions };
  const { selectedPath, activeLeafId } = defaultSelectedPath(root);

  return {
    root,
    qNodeMap,
    aNodeMap,
    parentMap,
    selectedPath,
    activeLeafId
  };
}

function pathToRoot(nodeId, parentMap) {
  const path = new Set();
  const visited = new Set();
  let currentId = nodeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    path.add(currentId);
    currentId = parentMap.get(currentId);
  }
  return path;
}

export function updateSelectedPath(tree, activeNodeId) {
  return {
    ...tree,
    selectedPath: pathToRoot(activeNodeId, tree.parentMap),
    activeLeafId: activeNodeId
  };
}
