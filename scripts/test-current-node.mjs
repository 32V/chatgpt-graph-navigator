import assert from 'node:assert/strict';
import { resolveCurrentNodeId } from '../src/content/parser/current-node.js';
import { buildQATree, updateSelectedPath } from '../src/sidepanel/utils/qa-tree.js';

const nodes = [
  { id: 'u1', role: 'user', content: 'hello', createTime: 1, parent: null, children: ['a1', 'a2'] },
  { id: 'a1', role: 'assistant', content: 'first', createTime: 2, parent: 'u1', children: ['u2'] },
  {
    id: 'a2',
    role: 'assistant',
    content: 'second',
    createTime: 3,
    parent: 'u1',
    children: [],
    metadata: { stream_part_ids: ['a2-preamble', 'a2-final'] }
  },
  { id: 'u2', role: 'user', content: 'follow up', createTime: 4, parent: 'a1', children: [] }
];

const edges = [
  { source: 'u1', target: 'a1' },
  { source: 'u1', target: 'a2' },
  { source: 'a1', target: 'u2' }
];

assert.equal(resolveCurrentNodeId('a2', nodes, {}), 'a2');
assert.equal(resolveCurrentNodeId('a2-final', nodes, {}), 'a2');

const rawMapping = {
  tool1: { parent: 'a1' },
  a1: { parent: 'u1' },
  u1: { parent: null }
};
assert.equal(resolveCurrentNodeId('tool1', nodes, rawMapping), 'a1');
assert.equal(resolveCurrentNodeId('missing', nodes, rawMapping), null);

const tree = buildQATree(nodes, edges);
const selected = updateSelectedPath(tree, 'u2');
assert.deepEqual(
  [...selected.selectedPath].sort(),
  ['a1', 'u1', 'u2'].sort(),
  'canonical current node should select exactly its ancestor path'
);
assert.equal(selected.activeLeafId, 'u2');

console.log('Canonical current-node checks passed.');
