import test from 'node:test';
import assert from 'node:assert/strict';

import { createRouteMediaLoader } from '../src/route-media-loader.js';

function decodedImage({ fail = false, decodeGate = null } = {}) {
  return {
    set src(value) {
      this.currentSrc = value;
      queueMicrotask(() => (fail ? this.onerror?.(new Error('load failed')) : this.onload?.()));
    },
    decode() {
      return decodeGate ?? Promise.resolve();
    },
  };
}

test('route loader reports an item ready only after its image has decoded', async () => {
  let releaseDecode;
  const decodeGate = new Promise((resolve) => { releaseDecode = resolve; });
  const events = [];
  const loader = createRouteMediaLoader({
    createImage: () => decodedImage({ decodeGate }),
    onProgress: (state) => events.push(state),
  });

  const pending = loader.load(['a.webp']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.at(-1).ready, 0);
  releaseDecode();
  const result = await pending;

  assert.equal(result.ready, 1);
  assert.equal(result.total, 1);
  assert.equal(events.at(-1).ratio, 1);
});

test('route loader retries a failed item and never repeats already decoded URLs', async () => {
  const attempts = new Map();
  const loader = createRouteMediaLoader({
    retries: 2,
    retryDelay: () => Promise.resolve(),
    createImage() {
      const attempt = (attempts.get('count') ?? 0) + 1;
      attempts.set('count', attempt);
      return decodedImage({ fail: attempt === 1 });
    },
  });

  assert.equal((await loader.load(['a.webp'])).ready, 1);
  assert.equal(attempts.get('count'), 2);
  assert.equal((await loader.load(['a.webp'])).ready, 1);
  assert.equal(attempts.get('count'), 2);
});

test('route loader keeps persistent failures for a retry-only pass', async () => {
  let fail = true;
  let attempts = 0;
  const loader = createRouteMediaLoader({
    retries: 0,
    createImage() {
      attempts += 1;
      return decodedImage({ fail });
    },
  });

  const first = await loader.load(['a.webp', 'b.webp']);
  assert.equal(first.ready, 0);
  assert.equal(first.failed, 2);
  fail = false;
  const retried = await loader.retryFailed();
  assert.equal(retried.ready, 2);
  assert.equal(retried.failed, 0);
  assert.equal(attempts, 4);
});

test('aborting a route loader prevents late decoded items from becoming ready', async () => {
  let releaseDecode;
  const decodeGate = new Promise((resolve) => { releaseDecode = resolve; });
  const loader = createRouteMediaLoader({
    createImage: () => decodedImage({ decodeGate }),
  });

  const pending = loader.load(['a.webp']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  loader.abort();
  releaseDecode();

  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  assert.equal(loader.snapshot().ready, 0);
});
