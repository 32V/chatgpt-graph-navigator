import assert from 'node:assert/strict';
import { normalizeAssistantStreamNodes } from '../src/content/parser/assistant-stream-normalizer.js';
import { ASSISTANT_STREAM_OUTPUT_MODES } from '../src/shared/constants.js';

const baseNodes = [
  {
    id: 'u1',
    role: 'user',
    content: 'question',
    createTime: 1,
    parent: null,
    children: ['a-part-1'],
    metadata: {}
  },
  {
    id: 'a-part-1',
    role: 'assistant',
    content: 'first part',
    createTime: 2,
    parent: 'u1',
    children: ['a-part-2'],
    metadata: {
      is_incremental: true,
      stream_group_key: 'answer-1',
      stream_group_part_index: 0
    }
  },
  {
    id: 'a-part-2',
    role: 'assistant',
    content: 'final part',
    createTime: 3,
    parent: 'a-part-1',
    children: ['u2'],
    metadata: {
      is_incremental: true,
      stream_group_key: 'answer-1',
      stream_group_part_index: 1
    }
  },
  {
    id: 'u2',
    role: 'user',
    content: 'follow up',
    createTime: 4,
    parent: 'a-part-2',
    children: [],
    metadata: {}
  }
];

const finalOnly = normalizeAssistantStreamNodes(baseNodes, {
  mode: ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY,
  conversationId: 'c1'
});
const finalMap = new Map(finalOnly.nodes.map(node => [node.id, node]));
assert.equal(finalMap.has('a-part-1'), false);
assert.equal(finalMap.has('a-part-2'), true);
assert.equal(finalMap.get('a-part-2').parent, 'u1');
assert.equal(finalMap.get('u2').parent, 'a-part-2');
assert.deepEqual(finalMap.get('a-part-2').metadata.stream_part_ids, ['a-part-1', 'a-part-2']);
assert.deepEqual(
  finalOnly.edges.map(edge => `${edge.source}->${edge.target}`).sort(),
  ['a-part-2->u2', 'u1->a-part-2']
);

const merged = normalizeAssistantStreamNodes(baseNodes, {
  mode: ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL,
  conversationId: 'c1'
});
const mergedMap = new Map(merged.nodes.map(node => [node.id, node]));
assert.equal(mergedMap.has('a-part-1'), true);
assert.equal(mergedMap.has('a-part-2'), false);
assert.equal(mergedMap.get('a-part-1').parent, 'u1');
assert.equal(mergedMap.get('u2').parent, 'a-part-1');
assert.equal(mergedMap.get('a-part-1').content, 'first part\n\nfinal part');
assert.deepEqual(
  merged.edges.map(edge => `${edge.source}->${edge.target}`).sort(),
  ['a-part-1->u2', 'u1->a-part-1']
);
assert.equal(
  merged.edges.some(edge => !Number.isFinite(edge.orderKey)),
  false,
  'normalized edge ordering must remain deterministic'
);

console.log('Assistant stream normalization checks passed.');
