import assert from 'node:assert/strict';
import test from 'node:test';

import { ASSISTANT_STREAM_OUTPUT_MODES } from '../src/shared/constants.js';
import { normalizeAssistantStreamNodes } from '../src/content/parser/assistant-stream-normalizer.js';
import { resolveCurrentNodeId } from '../src/content/parser/current-node.js';
import { buildPathToTarget, getSiblings } from '../src/content/utils/branch-navigator.js';
import {
  buildQATree,
  getQATreeStructureKey,
  updateSelectedPath
} from '../src/sidepanel/utils/qa-tree.js';
import { buildAndLayoutQATree } from '../src/sidepanel/utils/qaTreeLayout.js';

test('canonical graph model keeps topology, selection, and branch groups stable', () => {
  const nodes = [
    { id: 'u-root-b', role: 'user', content: 'later root', createTime: 10, parent: null, children: ['a-b'], _rawParent: 'root-b' },
    { id: 'a-b', role: 'assistant', content: 'later root answer', createTime: 11, parent: 'u-root-b', children: [] },
    { id: 'u-root-a', role: 'user', content: 'first root', createTime: 1, parent: null, children: ['a-a1', 'a-a2'], _rawParent: 'root-a' },
    { id: 'a-a2', role: 'assistant', content: 'second branch', createTime: 3, parent: 'u-root-a', children: [], metadata: { stream_part_ids: ['a2-preamble', 'a2-final'] } },
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
  assert.deepEqual(tree.root.questions.map(node => node.userId), ['u-root-a', 'u-root-b']);
  assert.deepEqual(tree.qNodeMap.get('u-root-a').answers.map(node => node.assistantId), ['a-a1', 'a-a2']);
  assert.deepEqual([...tree.selectedPath].sort(), ['a-b', 'u-root-b'].sort());

  const selected = updateSelectedPath(tree, 'u-child');
  assert.deepEqual([...selected.selectedPath].sort(), ['a-a1', 'u-child', 'u-root-a'].sort());
  assert.equal(selected.activeLeafId, 'u-child');

  const rawMapping = {
    tool1: { parent: 'a-a1' },
    'a-a1': { parent: 'u-root-a' },
    'u-root-a': { parent: null }
  };
  assert.equal(resolveCurrentNodeId('a2-final', nodes, rawMapping), 'a-a2');
  assert.equal(resolveCurrentNodeId('tool1', nodes, rawMapping), 'a-a1');
  assert.equal(resolveCurrentNodeId('missing', nodes, rawMapping), null);

  const rebuilt = buildQATree(nodes.map(node => ({ ...node })), edges.map(edge => ({ ...edge })));
  assert.equal(
    getQATreeStructureKey(rebuilt),
    getQATreeStructureKey(tree),
    'equivalent canonical snapshots must keep the same structural identity'
  );

  const reorderedNodes = nodes.map(node =>
    node.id === 'a-a1' ? { ...node, createTime: 4 } :
      node.id === 'a-a2' ? { ...node, createTime: 2 } : node
  );
  assert.notEqual(
    getQATreeStructureKey(buildQATree(reorderedNodes, edges)),
    getQATreeStructureKey(tree),
    'sibling-order changes must invalidate structural identity'
  );

  const cyclicSelection = updateSelectedPath({
    ...tree,
    parentMap: new Map([['x', 'y'], ['y', 'x']])
  }, 'x');
  assert.deepEqual([...cyclicSelection.selectedPath].sort(), ['x', 'y']);

  const rootNodeMap = new Map([
    ['r1', { id: 'r1', parent: null, _rawParent: 'native-a', createTime: 1 }],
    ['r2', { id: 'r2', parent: null, _rawParent: 'native-a', createTime: 2 }],
    ['r3', { id: 'r3', parent: null, _rawParent: 'native-b', createTime: 3 }]
  ]);
  assert.deepEqual(getSiblings('r1', rootNodeMap), ['r1', 'r2']);
  assert.deepEqual(buildPathToTarget('u-child', new Map(nodes.map(node => [node.id, node]))), [
    'u-root-a', 'a-a1', 'u-child'
  ]);
});

test('assistant stream normalization preserves one deterministic graph node', () => {
  const baseNodes = [
    { id: 'u1', role: 'user', content: 'question', createTime: 1, parent: null, children: ['a-part-1'], metadata: {} },
    {
      id: 'a-part-1', role: 'assistant', content: 'first part', createTime: 2,
      parent: 'u1', children: ['a-part-2'],
      metadata: { is_incremental: true, stream_group_key: 'answer-1', stream_group_part_index: 0 }
    },
    {
      id: 'a-part-2', role: 'assistant', content: 'final part', createTime: 3,
      parent: 'a-part-1', children: ['u2'],
      metadata: { is_incremental: true, stream_group_key: 'answer-1', stream_group_part_index: 1 }
    },
    { id: 'u2', role: 'user', content: 'follow up', createTime: 4, parent: 'a-part-2', children: [], metadata: {} }
  ];

  const finalOnly = normalizeAssistantStreamNodes(baseNodes, {
    mode: ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY,
    conversationId: 'c1'
  });
  const finalMap = new Map(finalOnly.nodes.map(node => [node.id, node]));
  assert.equal(finalMap.has('a-part-1'), false);
  assert.equal(finalMap.get('a-part-2').parent, 'u1');
  assert.equal(finalMap.get('u2').parent, 'a-part-2');
  assert.deepEqual(finalMap.get('a-part-2').metadata.stream_part_ids, ['a-part-1', 'a-part-2']);
  assert.deepEqual(finalOnly.edges.map(edge => `${edge.source}->${edge.target}`).sort(), [
    'a-part-2->u2', 'u1->a-part-2'
  ]);

  const merged = normalizeAssistantStreamNodes(baseNodes, {
    mode: ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL,
    conversationId: 'c1'
  });
  const mergedMap = new Map(merged.nodes.map(node => [node.id, node]));
  assert.equal(mergedMap.has('a-part-2'), false);
  assert.equal(mergedMap.get('a-part-1').content, 'first part\n\nfinal part');
  assert.equal(mergedMap.get('u2').parent, 'a-part-1');
  assert.deepEqual(merged.edges.map(edge => `${edge.source}->${edge.target}`).sort(), [
    'a-part-1->u2', 'u1->a-part-1'
  ]);
  assert.equal(merged.edges.every(edge => Number.isFinite(edge.orderKey)), true);
});

test('revealing single answers does not move the base graph', () => {
  const q3 = { userId: 'q3', content: 'q3', preview: 'q3', createTime: 5, answers: [] };
  const a2 = { assistantId: 'a2', content: 'a2', preview: 'a2', createTime: 4, nextQuestions: [q3] };
  const q2 = { userId: 'q2', content: 'q2', preview: 'q2', createTime: 3, answers: [a2] };
  const a1 = { assistantId: 'a1', content: 'a1', preview: 'a1', createTime: 2, nextQuestions: [q2] };
  const q1 = { userId: 'q1', content: 'q1', preview: 'q1', createTime: 1, answers: [a1] };
  const qaTree = {
    root: { questions: [q1] },
    qNodeMap: new Map([['q1', q1], ['q2', q2], ['q3', q3]]),
    aNodeMap: new Map([['a1', a1], ['a2', a2]])
  };

  const collapsed = buildAndLayoutQATree(qaTree, new Set(), 'TB', new Set());
  const expanded = buildAndLayoutQATree(qaTree, new Set(), 'TB', new Set(['q1']));
  const doubleExpanded = buildAndLayoutQATree(qaTree, new Set(), 'TB', new Set(['q1', 'q2']));
  const basePositions = new Map(collapsed.nodes.map(node => [node.id, node.position]));

  for (const graph of [expanded, doubleExpanded]) {
    const currentPositions = new Map(graph.nodes.map(node => [node.id, node.position]));
    for (const [id, position] of basePositions) {
      assert.deepEqual(currentPositions.get(id), position, `${id} moved during answer reveal`);
    }
  }

  assert.equal(collapsed.nodes.some(node => node.id === 'a-a1'), false);
  assert.equal(expanded.nodes.some(node => node.id === 'a-a1'), true);
  assert.equal(doubleExpanded.nodes.some(node => node.id === 'a-a2'), true);

  const edgeIds = new Set(expanded.edges.map(edge => `${edge.source}->${edge.target}`));
  assert.equal(edgeIds.has('q-q1->q-q2'), false);
  assert.equal(edgeIds.has('q-q1->a-a1'), true);
  assert.equal(edgeIds.has('a-a1->q-q2'), true);
});
