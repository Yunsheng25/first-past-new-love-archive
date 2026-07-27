import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategorizedMindmapRecords,
  buildMindmapGraph,
  buildProcessGraph,
  edgeKind,
  getExpandableChildren,
} from '../src/archive-mindmap-model.js';

test('leading error run branches from root and rejoins the first valid case', () => {
  const graph = buildProcessGraph([
    { id: 'e1', index: 1, status: 'error' },
    { id: 'e2', index: 2, status: 'error' },
    { id: 'ok', index: 3, status: 'normal' },
  ]);
  assert.deepEqual(graph.edges, [
    { from: 'root', to: 'ok', kind: 'main' },
    { from: 'root', to: 'e1', kind: 'error' },
    { from: 'e1', to: 'e2', kind: 'error' },
    { from: 'e2', to: 'ok', kind: 'return' },
  ]);
});

test('later errors leave the mainline and explicitly return to the next valid case', () => {
  const graph = buildProcessGraph([
    { id: 'a', index: 1, status: 'normal' },
    { id: 'e', index: 2, status: 'error' },
    { id: 'b', index: 3, status: 'normal' },
  ]);
  assert.deepEqual(graph.mainline.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(graph.edges.slice(1), [
    { from: 'a', to: 'b', kind: 'main' },
    { from: 'a', to: 'e', kind: 'error' },
    { from: 'e', to: 'b', kind: 'return' },
  ]);
});

test('public adapter expands process children without any category nodes', () => {
  const records = buildCategorizedMindmapRecords([
    { id: 'e', index: 1, status: 'error' },
    { id: 'a', index: 2, status: 'normal' },
    { id: 'b', index: 3, status: 'normal' },
  ]);
  const graph = buildMindmapGraph(records);
  assert.deepEqual(getExpandableChildren(graph, 'root').map((item) => item.id), ['a', 'e']);
  assert.equal(records.some((item) => item.isCategory), false);
  assert.equal(edgeKind(graph, 'e', 'a'), 'return');
});
