import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategorizedMindmapRecords,
  buildMindmapGraph,
  getExpandableChildren,
  MINDMAP_CATEGORIES,
} from '../src/archive-mindmap-model.js';

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

test('restores the original four first-level categories in their approved order', () => {
  assert.deepEqual(
    MINDMAP_CATEGORIES.map((item) => item.title),
    ['视觉方向探索', '人物与场景', '错误案例与修正', '首尾帧与动态'],
  );
});

test('classifies every case once and expands categories before their ordered cases', () => {
  const cases = [
    { id: 'image', index: 1, type: '生图', status: 'normal' },
    { id: 'person', index: 2, type: '图生视频', status: 'normal' },
    { id: 'error', index: 3, type: '首尾帧', status: 'error' },
    { id: 'frames', index: 4, type: '首尾帧', status: 'normal' },
  ];
  const records = buildCategorizedMindmapRecords(cases);
  const graph = buildMindmapGraph(records);
  assert.deepEqual(
    getExpandableChildren(graph, 'root').map((item) => item.title),
    ['视觉方向探索', '人物与场景', '错误案例与修正', '首尾帧与动态'],
  );
  assert.deepEqual(getExpandableChildren(graph, 'category-visual').map((item) => item.id), ['image']);
  assert.deepEqual(getExpandableChildren(graph, 'category-people').map((item) => item.id), ['person']);
  assert.deepEqual(getExpandableChildren(graph, 'category-errors').map((item) => item.id), ['error']);
  assert.deepEqual(getExpandableChildren(graph, 'category-motion').map((item) => item.id), ['frames']);
  assert.equal(records.filter((item) => !item.isCategory).length, cases.length);
});
