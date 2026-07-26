import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildAfterView } from '../src/views.js';
import { mountAfterCursor } from '../src/after-cursor.js';

function target() {
  const listeners = new Map();
  return {
    listeners,
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      toggle(value, force) { force ? this.values.add(value) : this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    },
    style: { setProperty(name, value) { this[name] = value; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
}

test('after view exposes the approved circular cursor and no splash canvas', () => {
  const html = buildAfterView();
  assert.match(html, /<span class="after-cursor" data-after-cursor aria-hidden="true"><\/span>/);
  assert.doesNotMatch(html, /data-after-splash/);
});

test('coarse pointers keep the native cursor and skip animation', () => {
  let scheduled = 0;
  const cleanup = mountAfterCursor(
    { querySelector: () => null },
    {
      matchMedia: () => ({ matches: false }),
      requestFrame: () => { scheduled += 1; },
    },
  );
  assert.equal(scheduled, 0);
  assert.doesNotThrow(cleanup);
});

test('mount binds pointer tracking and cleanup removes listeners and frame', () => {
  const view = target();
  const cursor = target();
  const root = {
    querySelector(selector) {
      if (selector === '.after-view') return view;
      if (selector === '[data-after-cursor]') return cursor;
      return null;
    },
  };
  let cancelled;
  const cleanup = mountAfterCursor(root, {
    matchMedia: (query) => ({ matches: query.includes('pointer: fine') }),
    requestFrame: () => 42,
    cancelFrame: (id) => { cancelled = id; },
  });
  assert.equal(view.listeners.has('pointermove'), true);
  assert.equal(view.classList.contains('cursor-ready'), true);
  cleanup();
  assert.equal(view.listeners.size, 0);
  assert.equal(view.classList.contains('cursor-ready'), false);
  assert.equal(cancelled, 42);
});

test('route entry mounts the cursor and removes the splash integration', async () => {
  const source = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ mountAfterCursor \} from '.\/src\/after-cursor\.js';/);
  assert.match(source, /currentViewCleanup = mountAfterCursor\(app\);/);
  assert.doesNotMatch(source, /mountAfterSplash/);
});
