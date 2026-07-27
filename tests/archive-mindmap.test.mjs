import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMindmapShell } from '../src/archive-mindmap.js';

test('mindmap shell exposes every required control', () => {
  const html = buildMindmapShell();
  for (const action of ['overview', 'restore', 'collapse']) {
    assert.match(html, new RegExp(`data-mindmap-action="${action}"`));
  }
  assert.match(html, /data-mindmap-root/);
  assert.match(html, /隧道漫游/);
  assert.match(html, /按白板顺序展开/);
  assert.match(html, /错误支线会回到主线/);
  for (const label of ['视觉方向探索', '人物与场景', '错误案例与修正', '首尾帧与动态']) {
    assert.doesNotMatch(html, new RegExp(label));
  }
});
