import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildAfterView } from '../src/views.js';
import { mountAfterSplash } from '../src/after-splash.js';

test('after view exposes a non-interactive splash canvas', () => {
  const html = buildAfterView();
  assert.match(html, /<canvas class="after-splash" data-after-splash aria-hidden="true"><\/canvas>/);
});

test('reduced motion skips WebGL initialization', () => {
  let contexts = 0;
  const canvas = { getContext() { contexts += 1; } };
  const root = { querySelector: () => canvas };
  const cleanup = mountAfterSplash(root, { matchMedia: () => ({ matches: true }) });
  assert.equal(contexts, 0);
  assert.equal(typeof cleanup, 'function');
});

test('missing WebGL support degrades to the static background', () => {
  let pointerListeners = 0;
  const canvas = {
    getContext: () => null,
    addEventListener: () => { pointerListeners += 1; },
  };
  const cleanup = mountAfterSplash(
    { querySelector: () => canvas },
    { matchMedia: () => ({ matches: false }) },
  );
  assert.equal(pointerListeners, 0);
  assert.doesNotThrow(cleanup);
});

test('route entry mounts the splash and stores its cleanup', async () => {
  const source = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ mountAfterSplash \} from '.\/src\/after-splash\.js';/);
  assert.match(source, /currentViewCleanup = mountAfterSplash\(app\);/);
});
