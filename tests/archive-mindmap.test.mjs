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
});
