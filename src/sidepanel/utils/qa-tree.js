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

function sortTree(questions, seenQuestions = new Set(), seenAnswers = new Set()) {
  questions.sort(sortByTimeOrId);

  for (const question of questions) {
    if (!question?.userId || seenQuestions.has(question.userId)) continue;
    seenQuestions.add(question.userId);
    question.answers.sort(sortByTimeOrId);

    for (const answer of question.answers) {
      if (!answer?.assistantId || seenAnswers.has(answer.assistantId)) continue;
      seenAnswers.add(answer.assistantId);
      sortTree(answer.nextQuestions, seenQuestions, seenAnswers);
    }
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
  const visited = new Set();
  let activeLeafId = null;
  let question = root.questions.at(-1) || null;

  while (question?.userId && !visited.has(`q:${question.userId}`)) {
    visited.add(`q:${question.userId}`);
    selectedPath.add(question.userId);
    activeLeafId = question.userId;

    const answer = question.answers.at(-1) || null;
    if (!answer?.assistantId || visited.has(`a:${answer.assistantId}`)) break;

    visited.add(`a:${answer.assistantId}`);
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

  const ancestorCache = new Map();
  const findAncestorByRole = (nodeId, role) => {
    const cacheKey = `${role}:${nodeId}`;
    if (ancestorCache.has(cacheKey)) return ancestorCache.get(cacheKey);

    let currentId = parentMap.get(nodeId);
    const visited = new Set();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = rawNodeMap.get(currentId);
      if (node?.role === role) {
        ancestorCache.set(cacheKey, currentId);
        return currentId;
      }
      currentId = parentMap.get(currentId);
    }

    ancestorCache.set(cacheKey, null);
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

/**
 * Stable semantic signature for the rendered QA topology. Object identity and
 * message text are intentionally ignored, while root/sibling order is kept.
 */
export function getQATreeStructureKey(tree) {
  if (!tree) return '';

  const parts = [
    `root:${(tree.root?.questions || []).map(question => question.userId).join(',')}`
  ];

  const questions = Array.from(tree.qNodeMap?.values?.() || [])
    .map(question => `q:${question.userId}>${(question.answers || []).map(answer => answer.assistantId).join(',')}`)
    .sort();
  const answers = Array.from(tree.aNodeMap?.values?.() || [])
    .map(answer => `a:${answer.assistantId}>${(answer.nextQuestions || []).map(question => question.userId).join(',')}`)
    .sort();

  return parts.concat(questions, answers).join('|');
}
