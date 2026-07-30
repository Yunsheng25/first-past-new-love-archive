import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMindmapShell, symmetricChildBoxes } from '../src/archive-mindmap.js';

const archiveMindmapSource = await readFile(new URL('../src/archive-mindmap.js', import.meta.url), 'utf8');

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

test('mindmap thumbnails use the prepared lightweight display images', () => {
  assert.match(archiveMindmapSource, /firstImage\.displaySrc\s*\?\?\s*firstImage\.src/);
});

test('two process branches are centered equally above and below their parent', () => {
  const parent = { x: 350, y: 1580, width: 220, height: 220 };
  const boxes = symmetricChildBoxes(parent, [{ id: 'main' }, { id: 'error' }]);
  const parentCenter = parent.y + parent.height / 2;
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].x, boxes[1].x);
  assert.equal(
    parentCenter - (boxes[0].y + boxes[0].height / 2),
    (boxes[1].y + boxes[1].height / 2) - parentCenter,
  );
});

test('archive canvas dragging ignores non-primary mouse buttons', () => {
  assert.match(archiveMindmapSource, /event\.button !== undefined && event\.button !== 0/);
});
