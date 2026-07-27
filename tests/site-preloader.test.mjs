import test from 'node:test';
import assert from 'node:assert/strict';
import { preloadAssets } from '../src/site-preloader.js';

test('preloads every asset and reports immutable monotonic real progress', async () => {
  const states = [];
  const result = await preloadAssets({
    assets: [{ path: 'a.jpg', bytes: 3 }, { path: 'b.mp4', bytes: 5 }],
    fetchImpl: async (path) => new Response(path === 'a.jpg' ? 'abc' : '12345'),
    onProgress: (state) => states.push(state),
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(states.at(-1), {
    status: 'complete',
    completedFiles: 2,
    totalFiles: 2,
    loadedBytes: 8,
    totalBytes: 8,
    percent: 100,
    currentPath: '',
  });
  assert.ok(states.every(Object.isFrozen));
  assert.ok(states.every((state, index) => index === 0 || state.loadedBytes >= states[index - 1].loadedBytes));
});

test('limits concurrency and retries a failed request twice', async () => {
  let active = 0;
  let highest = 0;
  const attempts = new Map();
  await preloadAssets({
    assets: Array.from({ length: 7 }, (_, index) => ({ path: `${index}.jpg`, bytes: 1 })),
    concurrency: 3,
    retries: 2,
    fetchImpl: async (path) => {
      active += 1;
      highest = Math.max(highest, active);
      attempts.set(path, (attempts.get(path) ?? 0) + 1);
      await Promise.resolve();
      active -= 1;
      if (path === '2.jpg' && attempts.get(path) < 3) return new Response('', { status: 503 });
      return new Response('x');
    },
  });
  assert.equal(highest, 3);
  assert.equal(attempts.get('2.jpg'), 3);
});

test('terminal failure identifies the asset and abort stops new work', async () => {
  await assert.rejects(
    preloadAssets({
      assets: [{ path: 'broken.jpg', bytes: 1 }],
      retries: 1,
      fetchImpl: async () => new Response('', { status: 500 }),
    }),
    /broken\.jpg/,
  );

  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    preloadAssets({
      assets: [{ path: 'a', bytes: 1 }, { path: 'b', bytes: 1 }],
      concurrency: 1,
      signal: controller.signal,
      fetchImpl: async () => {
        calls += 1;
        controller.abort();
        throw controller.signal.reason;
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});
