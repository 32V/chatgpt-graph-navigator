import assert from 'node:assert/strict';
import { buildQATree, updateSelectedPath } from '../src/sidepanel/utils/qa-tree.js';

const nodes = [
  { id: 'u-root-b', role: 'user', content: 'later root', createTime: 10, parent: null, children: ['a-b'] },
  { id: 'a-b', role: 'assistant', content: 'later root answer', createTime: 11, parent: 'u-root-b', children: [] },
  { id: 'u-root-a', role: 'user', content: 'first root', createTime: 1, parent: null, children: ['a-a1', 'a-a2'] },
  { id: 'a-a2', role: 'assistant', content: 'second branch', createTime: 3, parent: 'u-root-a', children: [] },
  { id: 'a-a1', role: 'assistant', content: 'first branch', createTime: 2, parent: 'u-root-a', children: ['u-child'] },
  { id: 'u-child', role: 'user', content: 'follow up', createTime: 4, parent: 'a-a1', children: [] }
];

const edges = [
  { source: 'u-root-a', target: 'a-a1' },
  { source: 'u-root-a', target: 'a-a2' },
  { source: 'a-a1', target: 'u-child' },
  { source: 'u-root-b', target: 'a-b' }
];

const tree = buildQATree(nodes, edges);
assert.deepEqual(
  tree.root.questions.map(node => node.userId),
  ['u-root-a', 'u-root-b'],
  'root questions should be deterministically ordered'
);
assert.deepEqual(
  tree.qNodeMap.get('u-root-a').answers.map(node => node.assistantId),
  ['a-a1', 'a-a2'],
  'answers should be deterministically ordered'
);
assert.deepEqual(
  tree.aNodeMap.get('a-a1').nextQuestions.map(node => node.userId),
  ['u-child'],
  'follow-up questions should attach to the nearest assistant ancestor'
);
assert.equal(tree.parentMap.get('u-child'), 'a-a1');
assert.deepEqual(
  [...tree.selectedPath].sort(),
  ['a-b', 'u-root-b'].sort(),
  'default selection should follow the latest root branch'
);

const selected = updateSelectedPath(tree, 'u-child');
assert.deepEqual(
  [...selected.selectedPath].sort(),
  ['a-a1', 'u-child', 'u-root-a'].sort(),
  'explicit selection should include exactly the canonical ancestor path'
);
assert.equal(selected.activeLeafId, 'u-child');

const cyclic = {
  ...tree,
  parentMap: new Map([
    ['x', 'y'],
    ['y', 'x']
  ])
};
const cyclicSelection = updateSelectedPath(cyclic, 'x');
assert.deepEqual([...cyclicSelection.selectedPath].sort(), ['x', 'y']);

console.log('QA tree model checks passed.');
