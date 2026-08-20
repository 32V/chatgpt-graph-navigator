import assert from 'node:assert/strict';
import { buildAndLayoutQATree } from '../src/sidepanel/utils/qaTreeLayout.js';

const q3 = {
  userId: 'q3',
  content: 'q3',
  preview: 'q3',
  createTime: 5,
  answers: []
};
const a2 = {
  assistantId: 'a2',
  content: 'a2',
  preview: 'a2',
  createTime: 4,
  nextQuestions: [q3]
};
const q2 = {
  userId: 'q2',
  content: 'q2',
  preview: 'q2',
  createTime: 3,
  answers: [a2]
};
const a1 = {
  assistantId: 'a1',
  content: 'a1',
  preview: 'a1',
  createTime: 2,
  nextQuestions: [q2]
};
const q1 = {
  userId: 'q1',
  content: 'q1',
  preview: 'q1',
  createTime: 1,
  answers: [a1]
};

const qaTree = {
  root: { questions: [q1] },
  qNodeMap: new Map([
    ['q1', q1],
    ['q2', q2],
    ['q3', q3]
  ]),
  aNodeMap: new Map([
    ['a1', a1],
    ['a2', a2]
  ])
};

const collapsed = buildAndLayoutQATree(qaTree, new Set(), 'TB', new Set());
const expanded = buildAndLayoutQATree(qaTree, new Set(), 'TB', new Set(['q1']));
const doubleExpanded = buildAndLayoutQATree(qaTree, new Set(), 'TB', new Set(['q1', 'q2']));

const positions = graph => new Map(graph.nodes.map(node => [node.id, node.position]));
const collapsedPositions = positions(collapsed);

for (const graph of [expanded, doubleExpanded]) {
  const currentPositions = positions(graph);
  for (const [id, position] of collapsedPositions) {
    assert.deepEqual(currentPositions.get(id), position, `${id} moved when revealing an answer node`);
  }
}

assert.equal(collapsed.nodes.some(node => node.id === 'a-a1'), false);
assert.equal(expanded.nodes.some(node => node.id === 'a-a1'), true);
assert.equal(doubleExpanded.nodes.some(node => node.id === 'a-a2'), true);

const edgeIds = new Set(expanded.edges.map(edge => `${edge.source}->${edge.target}`));
assert.equal(edgeIds.has('q-q1->q-q2'), false);
assert.equal(edgeIds.has('q-q1->a-a1'), true);
assert.equal(edgeIds.has('a-a1->q-q2'), true);

console.log('Stable answer reveal layout checks passed.');
