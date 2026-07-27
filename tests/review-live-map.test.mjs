import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REVIEW_LIVE_MAPS, resolveReviewMap, visibleReviewMapNodes } from '../src/review-live-map-model.js';

const reviewLiveMapSource = await readFile(new URL('../src/review-live-map.js', import.meta.url), 'utf8');

test('only real authored summary images resolve to independent live maps', () => {
  assert.equal(resolveReviewMap('Pasted image 20260620133330.png').id, 'image-generation');
  assert.equal(resolveReviewMap('Pasted image 20260716153618.png').id, 'editing');
  assert.equal(resolveReviewMap('Pasted image 20260620160734.png'), null);
});

test('image generation map keeps one process trunk before its authored top-level split', () => {
  const map = REVIEW_LIVE_MAPS['image-generation'];
  assert.deepEqual(map.roots, ['image-process']);
  assert.equal(map.nodes['image-process'].title, '生图过程拆解');
  assert.deepEqual(map.nodes['image-process'].children, ['style-master', 'specific-frame']);
  assert.deepEqual(visibleReviewMapNodes(map), ['image-process']);
  assert.deepEqual(
    visibleReviewMapNodes(map, new Set(['image-process'])),
    ['image-process', 'style-master', 'specific-frame'],
  );
  assert.deepEqual(
    visibleReviewMapNodes(map, new Set(['image-process', 'specific-frame', 'spatial-logic'])),
    ['image-process', 'style-master', 'specific-frame', 'spatial-logic', 'text-prompt', 'visual-reference', 'reset-camera'],
  );
});

test('every map child resolves to a real node and every media path stays in review media', () => {
  for (const map of Object.values(REVIEW_LIVE_MAPS)) {
    for (const node of Object.values(map.nodes)) {
      for (const child of node.children ?? []) assert.ok(map.nodes[child]);
      for (const src of node.media ?? []) assert.match(src, /^assets\/review-media\//);
    }
  }
});

test('review live-map dragging ignores non-primary mouse buttons', () => {
  assert.match(reviewLiveMapSource, /event\.button !== undefined && event\.button !== 0/);
});
