import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildAfterView, filmEndedDestination } from '../src/views.js';
import {
  FILM_END_TRANSITION_MS,
  LAST_FRAME_STORAGE_KEY,
  applyStoredLastFrame,
  bindFilmCompletion,
  clearStoredLastFrame,
} from '../src/after-film.js';
import { parseRoute } from '../src/router.js';

const projectRoot = new URL('../', import.meta.url);

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function fakeVideo() {
  return {
    videoWidth: 1920,
    videoHeight: 1080,
    listeners: new Map(),
    addEventListener(type, listener, options) {
      this.listeners.set(type, { listener, options });
    },
    dispatch(type) { this.listeners.get(type)?.listener({ type }); },
  };
}

test('after view has exactly two equal primary choices with the required destinations', () => {
  const html = buildAfterView();
  const primaryChoices = [...html.matchAll(/<a\b[^>]*data-after-primary[^>]*>/g)];

  assert.equal(primaryChoices.length, 2);
  assert.match(primaryChoices[0][0], /href="#review"/);
  assert.match(primaryChoices[1][0], /href="#archive"/);
  assert.match(html, />复盘手记</);
  assert.match(html, />提示词和图片</);
  assert.match(html, /影片已结束/);
  assert.match(html, /选择继续阅读的方向/);
  assert.match(html, /href="#film"[^>]*data-replay-film/);
  assert.match(html, /href="#"[^>]*>返回片头</);
});

test('after route is directly addressable', () => {
  assert.deepEqual(parseRoute('#after'), { name: 'after' });
  assert.equal(filmEndedDestination(), '#after');
});

test('film completion captures one frame and navigates exactly once', () => {
  const video = fakeVideo();
  const storage = fakeStorage();
  const drawCalls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (...args) => drawCalls.push(args) }),
    toDataURL: () => 'data:image/jpeg;base64,finished-frame',
  };
  const destinations = [];
  const endingClasses = new Set();
  const filmView = { classList: { add: (name) => endingClasses.add(name) } };
  const scheduled = [];
  const root = {
    querySelector(selector) {
      if (selector === '.film-video') return video;
      if (selector === '.film-view') return filmView;
      return null;
    },
  };

  bindFilmCompletion(root, {
    storage,
    documentRef: { createElement: () => canvas },
    navigate: (destination) => destinations.push(destination),
    matchMedia: () => ({ matches: false }),
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  video.dispatch('ended');
  video.dispatch('ended');

  assert.equal(video.listeners.has('error'), false);
  assert.equal(video.listeners.get('ended').options?.once, true);
  assert.equal(drawCalls.length, 1);
  assert.equal(storage.getItem(LAST_FRAME_STORAGE_KEY), 'data:image/jpeg;base64,finished-frame');
  assert.equal(endingClasses.has('is-ending'), true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, FILM_END_TRANSITION_MS);
  assert.ok(FILM_END_TRANSITION_MS >= 900 && FILM_END_TRANSITION_MS <= 1000);
  assert.deepEqual(destinations, []);

  scheduled[0].callback();
  scheduled[0].callback();
  assert.deepEqual(destinations, ['#after']);
});

test('frame capture failure never blocks the ended navigation', () => {
  const video = fakeVideo();
  const destinations = [];
  const scheduled = [];

  bindFilmCompletion(
    { querySelector: () => video },
    {
      storage: { setItem() { throw new Error('quota exceeded'); } },
      documentRef: {
        createElement: () => ({
          getContext: () => ({ drawImage() {} }),
          toDataURL: () => 'data:image/jpeg;base64,too-large',
        }),
      },
      navigate: (destination) => destinations.push(destination),
      matchMedia: () => ({ matches: false }),
      schedule: (callback, delay) => scheduled.push({ callback, delay }),
    },
  );

  assert.doesNotThrow(() => video.dispatch('ended'));
  assert.deepEqual(destinations, []);
  assert.equal(scheduled.length, 1);
  scheduled[0].callback();
  assert.deepEqual(destinations, ['#after']);
});

test('reduced motion skips the ending delay and never schedules a timer', () => {
  const video = fakeVideo();
  const destinations = [];
  let scheduleCalls = 0;

  bindFilmCompletion(
    { querySelector: () => video },
    {
      documentRef: null,
      navigate: (destination) => destinations.push(destination),
      matchMedia: () => ({ matches: true }),
      schedule: () => { scheduleCalls += 1; },
    },
  );

  video.dispatch('ended');
  assert.equal(scheduleCalls, 0);
  assert.deepEqual(destinations, ['#after']);
});

test('only valid stored frames are applied and replay clears the stale frame', () => {
  const backdrop = { style: {} };
  const root = { querySelector: () => backdrop };
  const valid = fakeStorage({
    [LAST_FRAME_STORAGE_KEY]: 'data:image/jpeg;base64,abc123',
  });

  assert.equal(applyStoredLastFrame(root, valid), true);
  assert.equal(backdrop.style.backgroundImage, 'url("data:image/jpeg;base64,abc123")');
  clearStoredLastFrame(valid);
  assert.equal(valid.getItem(LAST_FRAME_STORAGE_KEY), null);

  const invalid = fakeStorage({ [LAST_FRAME_STORAGE_KEY]: 'https://example.com/not-ours.jpg' });
  backdrop.style.backgroundImage = '';
  assert.equal(applyStoredLastFrame(root, invalid), false);
  assert.equal(backdrop.style.backgroundImage, '');
});

test('after screen stays within one viewport and stacks choices on mobile and short screens', async () => {
  const [css, script] = await Promise.all([
    readFile(new URL('style.css', projectRoot), 'utf8'),
    readFile(new URL('script.js', projectRoot), 'utf8'),
  ]);

  assert.match(css, /\.after-view[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.after-choices[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.film-view\.is-ending\s+\.film-video[\s\S]*opacity:/);
  assert.match(css, /\.after-content[\s\S]*animation:/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.after-choices[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media\s*\(max-height:\s*560px\)[\s\S]*\.after-view/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)\s*and\s*\(max-height:\s*560px\)[\s\S]*\.after-choice[\s\S]*min-height:\s*68px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.after-content[\s\S]*animation:\s*none/);
  assert.match(script, /route\.name === 'after'/);
  assert.match(script, /bindFilmCompletion\(app/);
  assert.match(script, /applyStoredLastFrame\(app/);
});
