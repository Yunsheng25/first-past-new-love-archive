import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_LIVE_MAPS, resolveReviewMap, visibleReviewMapNodes } from '../src/review-live-map-model.js';

test('only real authored summary images resolve to independent live maps', () => {
  assert.equal(resolveReviewMap('Pasted image 20260620133330.png').id, 'image-generation');
  assert.equal(resolveReviewMap('Pasted image 20260716153618.png').id, 'editing');
  assert.equal(resolveReviewMap('Pasted image 20260620160734.png'), null);
});

test('image generation map expands progressively from its authored top-level split', () => {
  const map = REVIEW_LIVE_MAPS['image-generation'];
  assert.deepEqual(visibleReviewMapNodes(map), ['style-master', 'specific-frame']);
  assert.deepEqual(
    visibleReviewMapNodes(map, new Set(['specific-frame', 'spatial-logic'])),
    ['style-master', 'specific-frame', 'spatial-logic', 'text-prompt', 'visual-reference', 'reset-camera'],
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
