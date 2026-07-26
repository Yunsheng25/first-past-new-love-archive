import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildAfterView, filmEndedDestination } from '../src/views.js';
import {
  FILM_END_TRANSITION_MS,
  LAST_FRAME_STORAGE_KEY,
  applyStoredLastFrame,
  bindFilmCompletion,
  bindFilmExit,
  bindFilmFullscreen,
  captureFilmFrame,
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
    removeEventListener(type, listener) {
      if (this.listeners.get(type)?.listener === listener) this.listeners.delete(type);
    },
    dispatch(type) { this.listeners.get(type)?.listener({ type }); },
  };
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener({ type, ...event });
    },
    listenerCount(type) { return (listeners.get(type) ?? []).length; },
    listener(type) { return (listeners.get(type) ?? [])[0]; },
  };
}

function createFilmExitHarness({ pauseThrows = false } = {}) {
  const video = { ...fakeEventTarget(), pauseCalls: 0, pause() { this.pauseCalls += 1; if (pauseThrows) throw new Error('pause failed'); } };
  const exit = { ...fakeEventTarget() };
  const documentRef = fakeEventTarget();
  const root = {
    querySelector(selector) {
      if (selector === '.film-video') return video;
      if (selector === '[data-exit-film]') return exit;
      return null;
    },
  };
  const destinations = [];
  return { video, exit, documentRef, root, destinations };
}

function createFilmFullscreenHarness() {
  const stage = { ...fakeEventTarget(), requestCalls: 0, requestFullscreen() { this.requestCalls += 1; return Promise.resolve(); } };
  const video = { ...fakeEventTarget(), requestCalls: 0, webkitExitCalls: 0, requestFullscreen() { this.requestCalls += 1; }, webkitExitFullscreen() { this.webkitExitCalls += 1; } };
  const button = {
    ...fakeEventTarget(),
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name); },
  };
  const documentRef = {
    ...fakeEventTarget(),
    fullscreenElement: null,
    exitCalls: 0,
    exitFullscreen() { this.exitCalls += 1; return Promise.resolve(); },
  };
  const root = {
    querySelector(selector) {
      if (selector === '[data-film-stage]') return stage;
      if (selector === '.film-video') return video;
      if (selector === '[data-film-fullscreen]') return button;
      return null;
    },
  };
  return { stage, video, button, documentRef, root };
}

test('film fullscreen button requests fullscreen for the stage and exits on its second click', () => {
  const harness = createFilmFullscreenHarness();
  bindFilmFullscreen(harness.root, { documentRef: harness.documentRef });

  harness.button.dispatch('click');
  assert.equal(harness.stage.requestCalls, 1);
  assert.equal(harness.video.requestCalls, 0);

  harness.documentRef.fullscreenElement = harness.stage;
  harness.documentRef.dispatch('fullscreenchange');
  assert.equal(harness.button.getAttribute('aria-pressed'), 'true');
  assert.equal(harness.button.getAttribute('aria-label'), '退出全屏观看');
  harness.button.dispatch('click');
  assert.equal(harness.documentRef.exitCalls, 1);
});

test('film fullscreen is announced as unavailable when the stage has no fullscreen API', () => {
  const harness = createFilmFullscreenHarness();
  delete harness.stage.requestFullscreen;
  bindFilmFullscreen(harness.root, { documentRef: harness.documentRef });

  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.getAttribute('aria-disabled'), 'true');
  assert.equal(harness.button.getAttribute('aria-pressed'), 'false');
  assert.match(harness.button.getAttribute('aria-label'), /不可用/);
});

test('a rejected fullscreen request disables the unavailable control without an unhandled rejection', async () => {
  const harness = createFilmFullscreenHarness();
  harness.stage.requestFullscreen = () => Promise.reject(new Error('permission denied'));
  bindFilmFullscreen(harness.root, { documentRef: harness.documentRef });

  harness.button.dispatch('click');
  await Promise.resolve();

  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.getAttribute('aria-disabled'), 'true');
  assert.match(harness.button.getAttribute('aria-label'), /不可用/);
});

test('a fullscreen rejection queued after cleanup does not mutate the detached button', async () => {
  const harness = createFilmFullscreenHarness();
  let reject;
  harness.stage.requestFullscreen = () => new Promise((resolve, rejectRequest) => { reject = rejectRequest; });
  const cleanup = bindFilmFullscreen(harness.root, { documentRef: harness.documentRef });

  harness.button.dispatch('click');
  cleanup();
  reject(new Error('permission denied'));
  await Promise.resolve();

  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.getAttribute('aria-disabled'), 'false');
});

test('film fullscreen immediately escapes video-only and WebKit fullscreen fallbacks', () => {
  const harness = createFilmFullscreenHarness();
  bindFilmFullscreen(harness.root, { documentRef: harness.documentRef });

  harness.documentRef.fullscreenElement = harness.video;
  harness.documentRef.dispatch('fullscreenchange');
  harness.video.dispatch('webkitbeginfullscreen');
  assert.equal(harness.documentRef.exitCalls, 1);
  assert.equal(harness.video.webkitExitCalls, 1);
  assert.equal(harness.button.getAttribute('aria-pressed'), 'false');
});

test('film fullscreen cleanup makes captured handlers inert', () => {
  const harness = createFilmFullscreenHarness();
  const cleanup = bindFilmFullscreen(harness.root, { documentRef: harness.documentRef });
  const staleClick = harness.button.listener('click');
  const staleChange = harness.documentRef.listener('fullscreenchange');
  const staleWebkit = harness.video.listener('webkitbeginfullscreen');

  cleanup();
  cleanup();
  harness.documentRef.fullscreenElement = harness.video;
  staleClick();
  staleChange();
  staleWebkit();
  assert.equal(harness.stage.requestCalls, 0);
  assert.equal(harness.documentRef.exitCalls, 0);
  assert.equal(harness.video.webkitExitCalls, 0);
});

test('film exit click pauses immediately and navigates to the after screen once', () => {
  const harness = createFilmExitHarness();
  const cleanup = bindFilmExit(harness.root, {
    documentRef: harness.documentRef,
    navigate: (destination) => harness.destinations.push(destination),
  });
  let prevented = false;

  harness.exit.dispatch('click', { preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(harness.video.pauseCalls, 1);
  assert.deepEqual(harness.destinations, ['#after']);
  cleanup();
});

test('film exit responds only to Escape and remains idempotent across repeated inputs', () => {
  const harness = createFilmExitHarness();
  bindFilmExit(harness.root, {
    documentRef: harness.documentRef,
    navigate: (destination) => harness.destinations.push(destination),
  });

  harness.documentRef.dispatch('keydown', { key: 'Enter' });
  assert.equal(harness.video.pauseCalls, 0);
  assert.deepEqual(harness.destinations, []);

  let escapePrevented = false;
  harness.documentRef.dispatch('keydown', { key: 'Escape', preventDefault() { escapePrevented = true; } });
  harness.exit.dispatch('click', { preventDefault() {} });
  harness.documentRef.dispatch('keydown', { key: 'Escape' });
  assert.equal(escapePrevented, true);
  assert.equal(harness.video.pauseCalls, 1);
  assert.deepEqual(harness.destinations, ['#after']);
});

test('film exit cleanup removes exact listeners and makes queued events inert', () => {
  const harness = createFilmExitHarness();
  const cleanup = bindFilmExit(harness.root, {
    documentRef: harness.documentRef,
    navigate: (destination) => harness.destinations.push(destination),
  });

  assert.equal(harness.exit.listenerCount('click'), 1);
  assert.equal(harness.documentRef.listenerCount('keydown'), 1);
  const staleClick = harness.exit.listener('click');
  const staleKeydown = harness.documentRef.listener('keydown');
  cleanup();
  cleanup();
  let clickPrevented = false;
  let keyPrevented = false;
  staleClick({ preventDefault() { clickPrevented = true; } });
  staleKeydown({ key: 'Escape', preventDefault() { keyPrevented = true; } });
  assert.equal(harness.exit.listenerCount('click'), 0);
  assert.equal(harness.documentRef.listenerCount('keydown'), 0);
  assert.equal(clickPrevented, false);
  assert.equal(keyPrevented, false);
  assert.equal(harness.video.pauseCalls, 0);
  assert.deepEqual(harness.destinations, []);
});

test('a pause failure does not prevent film exit navigation', () => {
  const harness = createFilmExitHarness({ pauseThrows: true });
  bindFilmExit(harness.root, {
    documentRef: harness.documentRef,
    navigate: (destination) => harness.destinations.push(destination),
  });

  assert.doesNotThrow(() => harness.exit.dispatch('click', { preventDefault() {} }));
  assert.equal(harness.video.pauseCalls, 1);
  assert.deepEqual(harness.destinations, ['#after']);
});

test('a failed film exit navigation releases the lock for a later successful retry', () => {
  const harness = createFilmExitHarness();
  let attempts = 0;
  bindFilmExit(harness.root, {
    documentRef: harness.documentRef,
    navigate(destination) {
      attempts += 1;
      if (attempts === 1) throw new Error('navigation unavailable');
      harness.destinations.push(destination);
    },
  });
  let clickPrevented = false;
  let escapePrevented = false;

  assert.doesNotThrow(() => harness.exit.dispatch('click', { preventDefault() { clickPrevented = true; } }));
  harness.documentRef.dispatch('keydown', { key: 'Escape', preventDefault() { escapePrevented = true; } });
  harness.exit.dispatch('click', { preventDefault() { throw new Error('successful exit must stay idempotent'); } });

  assert.equal(clickPrevented, true);
  assert.equal(escapePrevented, true);
  assert.equal(attempts, 2);
  assert.equal(harness.video.pauseCalls, 2);
  assert.deepEqual(harness.destinations, ['#after']);
});

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

  const cleanup = bindFilmCompletion(root, {
    storage,
    documentRef: { createElement: () => canvas },
    navigate: (destination) => destinations.push(destination),
    matchMedia: () => ({ matches: false }),
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return 'ending-timer';
    },
    isCurrent: () => true,
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
  assert.equal(typeof cleanup, 'function');
  assert.ok(FILM_END_TRANSITION_MS >= 900 && FILM_END_TRANSITION_MS <= 1000);
  assert.deepEqual(destinations, []);

  scheduled[0].callback();
  scheduled[0].callback();
  assert.deepEqual(destinations, ['#after']);
});

test('leaving the film cancels its pending transition and stale callbacks cannot navigate', () => {
  const video = fakeVideo();
  const destinations = [];
  const scheduled = [];
  const cancelled = [];
  let isCurrent = true;

  const cleanup = bindFilmCompletion(
    { querySelector: () => video },
    {
      documentRef: null,
      navigate: (destination) => destinations.push(destination),
      matchMedia: () => ({ matches: false }),
      isCurrent: () => isCurrent,
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay });
        return 41;
      },
      cancelSchedule: (timerId) => cancelled.push(timerId),
    },
  );

  video.dispatch('ended');
  assert.equal(scheduled.length, 1);

  isCurrent = false;
  cleanup();
  scheduled[0].callback();
  assert.deepEqual(cancelled, [41]);
  assert.deepEqual(destinations, []);

  const secondVideo = fakeVideo();
  const secondScheduled = [];
  bindFilmCompletion(
    { querySelector: () => secondVideo },
    {
      documentRef: null,
      navigate: (destination) => destinations.push(destination),
      matchMedia: () => ({ matches: false }),
      isCurrent: () => false,
      schedule: (callback) => secondScheduled.push(callback),
    },
  );
  secondVideo.dispatch('ended');
  secondScheduled[0]();
  assert.deepEqual(destinations, []);
});

test('cleanup before ended removes the listener and prevents all completion side effects', () => {
  const video = fakeVideo();
  const sideEffects = {
    canvas: 0,
    storageReads: 0,
    storageWrites: 0,
    storageRemovals: 0,
    schedules: 0,
    navigations: 0,
  };
  const storage = {
    getItem() { sideEffects.storageReads += 1; return null; },
    setItem() { sideEffects.storageWrites += 1; },
    removeItem() { sideEffects.storageRemovals += 1; },
  };

  const cleanup = bindFilmCompletion(
    { querySelector: () => video },
    {
      storage,
      documentRef: {
        createElement() {
          sideEffects.canvas += 1;
          return null;
        },
      },
      navigate: () => { sideEffects.navigations += 1; },
      matchMedia: () => ({ matches: false }),
      schedule: () => { sideEffects.schedules += 1; },
    },
  );

  cleanup();
  cleanup();
  video.dispatch('ended');

  assert.equal(video.listeners.has('ended'), false);
  assert.deepEqual(sideEffects, {
    canvas: 0,
    storageReads: 0,
    storageWrites: 0,
    storageRemovals: 0,
    schedules: 0,
    navigations: 0,
  });
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

test('a new capture invalidates stale frames before drawing or storing can fail', () => {
  const staleStorage = fakeStorage({
    [LAST_FRAME_STORAGE_KEY]: 'data:image/jpeg;base64,stale',
  });
  const backdrop = { style: {} };
  const root = { querySelector: () => backdrop };

  assert.equal(captureFilmFrame(fakeVideo(), {
    storage: staleStorage,
    documentRef: { createElement() { throw new Error('canvas unavailable'); } },
  }), false);
  assert.equal(applyStoredLastFrame(root, staleStorage), false);

  const setFailureStorage = fakeStorage({
    [LAST_FRAME_STORAGE_KEY]: 'data:image/jpeg;base64,another-old-frame',
  });
  setFailureStorage.setItem = () => { throw new Error('quota exceeded'); };
  assert.equal(captureFilmFrame(fakeVideo(), {
    storage: setFailureStorage,
    documentRef: {
      createElement: () => ({
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,new-frame',
      }),
    },
  }), false);
  assert.equal(applyStoredLastFrame(root, setFailureStorage), false);
});

test('storage removal errors do not block invalidation or film completion', () => {
  const throwingStorage = {
    getItem: () => 'data:image/jpeg;base64,stale',
    setItem() { throw new Error('storage denied'); },
    removeItem() { throw new Error('storage denied'); },
  };
  const root = { querySelector: () => ({ style: {} }) };

  assert.doesNotThrow(() => clearStoredLastFrame(throwingStorage));
  assert.equal(applyStoredLastFrame(root, throwingStorage), false);
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
  assert.match(script, /currentViewCleanup\(\)[\s\S]*route\.name === 'film'/);
  assert.match(script, /route\.name === 'film'[\s\S]*clearStoredLastFrame\(\)[\s\S]*bindFilmCompletion\(app/);
});

test('after screen mounts the same interactive particle field beneath its choices', async () => {
  const [html, script] = await Promise.all([
    Promise.resolve(buildAfterView()),
    readFile(new URL('script.js', projectRoot), 'utf8'),
  ]);
  assert.match(html, /class="after-ambient"[^>]*data-mindmap-ambient/);
  assert.match(script, /mountMindmapAmbient/);
  assert.match(script, /route\.name === 'after'[\s\S]*mountMindmapAmbient/);
});
