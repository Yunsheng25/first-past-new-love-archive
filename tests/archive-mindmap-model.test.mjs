import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMindmapGraph, getExpandableChildren } from '../src/archive-mindmap-model.js';

test('keeps real outgoing branches and falls back to sequential order', () => {
  const records = [
    { id: 'a', index: 1, connections: [{ direction: '出线', toNode: 'b' }, { direction: '出线', toNode: 'c' }] },
    { id: 'b', index: 2, connections: [] },
    { id: 'c', index: 3, connections: [] },
  ];
  const graph = buildMindmapGraph(records);
  assert.deepEqual(getExpandableChildren(graph, 'a').map((item) => item.id), ['b', 'c']);
  assert.deepEqual(getExpandableChildren(graph, 'b').map((item) => item.id), ['c']);
});
