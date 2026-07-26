import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBounds, restoreReadingView } from '../src/mindmap-camera.js';

test('fitBounds centers visible boxes inside the viewport', () => {
  const result = fitBounds(
    [{ x: 350, y: 1580, width: 220, height: 220 }, { x: 2470, y: 1485, width: 230, height: 145 }],
    { width: 1440, height: 806 },
    80,
  );
  assert.ok(result.scale > 0);
  assert.ok(Number.isFinite(result.x));
  assert.ok(Number.isFinite(result.y));
});

test('restoreReadingView returns standard scale around the latest node', () => {
  assert.deepEqual(
    restoreReadingView({ x: 760, y: 1595, width: 286, height: 186 }, { width: 1440, height: 806 }),
    { scale: 0.72, x: 864 - 903 * 0.72, y: 403 - 1688 * 0.72 },
  );
});
