import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildFilmView,
  buildIntroView,
  buildPendingView,
} from '../src/views.js';
import { BGM_PREFERENCE_KEY, createAudioManager } from '../src/audio-manager.js';
import { createBgmController } from '../src/bgm-ui.js';

const projectRoot = new URL('../', import.meta.url);

test('intro view uses the optimized film as a full-screen silent looping background', () => {
  const html = buildIntroView();

  assert.match(html, /class="intro-film"/);
  assert.match(html, /src="assets\/video\/intro-background\.mp4"/);
  assert.match(html, /autoplay/);
  assert.match(html, /muted/);
  assert.match(html, /loop/);
  assert.match(html, /playsinline/);
  assert.doesNotMatch(html, /playbackRate/i);
});

test('intro view keeps the approved title hierarchy without revealing deep navigation', () => {
  const html = buildIntroView();

  assert.match(html, /初恋\s*·\s*旧爱\s*·\s*新欢/);
  assert.match(html, /MEMORY\s*<span[^>]*>·<\/span>\s*CHOICE\s*<span[^>]*>·<\/span>\s*AFTERWARDS/);
  assert.match(html, /FIRST LOVE/);
  assert.match(html, /PAST LOVE/);
  assert.match(html, /NEW LOVE/);
  assert.match(html, /每一段情感，都是时光里的一次遇见/);
  assert.match(html, /Like the first time, like the reunion, like what comes after\./);
  assert.match(html, /href="#film"[^>]*>\s*观看成片/);
  assert.doesNotMatch(html, /href="#archive"/);
  assert.doesNotMatch(html, /href="#review"/);
  assert.doesNotMatch(html, /href="#about"/);
  assert.match(html, /href="#film"[^>]*class="watch-film/);
});

test('intro does not reveal either post-film choice before the film', () => {
  const html = buildIntroView();

  assert.doesNotMatch(html, />提示词和图片</);
  assert.doesNotMatch(html, /class="after-film/);
  assert.doesNotMatch(html, /重新观看影片/);
});

test('film view plays the full film at normal speed with sound-capable controls', () => {
  const html = buildFilmView();
  const filmVideo = html.match(/<video\b[\s\S]*?<\/video>/)?.[0] ?? '';

  assert.match(filmVideo, /src="assets\/video\/full-film\.mp4"/);
  assert.match(filmVideo, /controls/);
  assert.match(filmVideo, /controlsList="nofullscreen"/);
  assert.match(filmVideo, /playsinline/);
  assert.doesNotMatch(html, /\bmuted\b/);
  assert.doesNotMatch(html, /\bloop\b/);
  assert.doesNotMatch(html, /autoplay/);
  assert.match(html, /href="#after"[^>]*class="film-exit"[^>]*data-exit-film[^>]*>[\s\S]*?退出影片/);
  assert.doesNotMatch(html, />复盘手记</);
  assert.doesNotMatch(html, />提示词和图片</);
});

test('both videos render visible recovery controls for playback or loading failures', () => {
  const intro = buildIntroView();
  const film = buildFilmView();

  assert.match(intro, /class="media-status intro-media-status"/);
  assert.match(intro, /data-intro-media-message/);
  assert.match(intro, /data-retry-intro[^>]*>播放背景</);
  assert.match(film, /class="media-status film-media-status"/);
  assert.match(film, /data-film-media-message/);
  assert.match(film, /data-retry-film[^>]*>重新播放</);
});

test('media bindings expose failed playback and let the user retry', async () => {
  let mediaUi;
  try {
    mediaUi = await import('../src/media-ui.js');
  } catch {
    mediaUi = {};
  }
  assert.equal(typeof mediaUi.bindIntroMedia, 'function');
  assert.equal(typeof mediaUi.bindFilmMedia, 'function');

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const fakeElement = () => ({
    hidden: true,
    textContent: '',
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    dispatch(type) { this.listeners.get(type)?.({ type, preventDefault() {} }); },
  });

  const introVideo = fakeElement();
  introVideo.pause = () => {};
  introVideo.play = () => Promise.reject(new Error('autoplay denied'));
  let introLoads = 0;
  introVideo.load = () => { introLoads += 1; introVideo.error = null; };
  const introStatus = fakeElement();
  const introMessage = fakeElement();
  const introRetry = fakeElement();
  const introNodes = new Map([
    ['.intro-film', introVideo],
    ['.intro-media-status', introStatus],
    ['[data-intro-media-message]', introMessage],
    ['[data-retry-intro]', introRetry],
  ]);

  mediaUi.bindIntroMedia({ querySelector: (selector) => introNodes.get(selector) }, { reduceMotion: false });
  await flush();
  assert.equal(introStatus.hidden, false);
  assert.match(introMessage.textContent, /未能自动播放/);

  introVideo.play = () => Promise.resolve();
  introVideo.error = { code: 4 };
  introRetry.dispatch('click');
  await flush();
  assert.equal(introLoads, 1);
  assert.equal(introStatus.hidden, true);

  const filmVideo = fakeElement();
  filmVideo.play = () => Promise.reject(new Error('play denied'));
  let filmLoads = 0;
  filmVideo.load = () => { filmLoads += 1; filmVideo.error = null; };
  const filmStatus = fakeElement();
  const filmMessage = fakeElement();
  const filmRetry = fakeElement();
  const filmNodes = new Map([
    ['.film-video', filmVideo],
    ['.film-media-status', filmStatus],
    ['[data-film-media-message]', filmMessage],
    ['[data-retry-film]', filmRetry],
  ]);

  mediaUi.bindFilmMedia({ querySelector: (selector) => filmNodes.get(selector) }, { playImmediately: true });
  await flush();
  assert.equal(filmStatus.hidden, false);
  assert.match(filmMessage.textContent, /影片加载失败/);

  filmVideo.play = () => Promise.resolve();
  filmVideo.error = { code: 4 };
  filmRetry.dispatch('click');
  await flush();
  assert.equal(filmLoads, 1);
  assert.equal(filmStatus.hidden, true);

  filmVideo.dispatch('error');
  assert.equal(filmStatus.hidden, false);
  assert.match(filmMessage.textContent, /影片加载失败/);
});

test('render focus moves to the current shell, with film preference only after a play gesture', async () => {
  let mediaUi;
  try {
    mediaUi = await import('../src/media-ui.js');
  } catch {
    mediaUi = {};
  }
  assert.equal(typeof mediaUi.focusRenderedView, 'function');

  const film = { focusOptions: null, focus(options) { this.focusOptions = options; } };
  const app = {
    focusOptions: null,
    focus(options) { this.focusOptions = options; },
    querySelector(selector) { return selector === '.film-video' ? film : null; },
  };

  mediaUi.focusRenderedView(app);
  assert.deepEqual(app.focusOptions, { preventScroll: true });
  mediaUi.focusRenderedView(app, { preferFilm: true });
  assert.deepEqual(film.focusOptions, { preventScroll: true });
});

test('unimplemented navigation destinations are explicitly marked as pending', () => {
  const html = buildPendingView('archive-index');

  assert.match(html, /后续阶段/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /case-card|review-page/);
});

test('site shell is a module-driven, single-viewport application', async () => {
  const [documentHtml, css, script] = await Promise.all([
    readFile(new URL('index.html', projectRoot), 'utf8'),
    readFile(new URL('style.css', projectRoot), 'utf8'),
    readFile(new URL('script.js', projectRoot), 'utf8'),
  ]);

  assert.match(documentHtml, /<main id="app"[^>]*tabindex="-1"/);
  assert.match(documentHtml, /<script type="module" src="script\.js"><\/script>/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /\.intro-film[\s\S]*object-fit:\s*cover/);
  assert.match(css, /\.intro-film[\s\S]*opacity:\s*0\.6[0-8]/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)\s*and\s*\(max-height:\s*400px\)/);
  assert.match(css, /max-height:\s*400px[\s\S]*\.hero-eyebrow[\s\S]*display:\s*none/);
  assert.match(script, /bindIntroMedia\(app/);
  assert.match(script, /bindFilmMedia\(app/);
  assert.match(script, /bindFilmExit\(app/);
  assert.match(script, /focusRenderedView\(app/);

  const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('script.js', projectRoot))], {
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('global BGM control persists outside routes and is wired to route audio state', async () => {
  const [documentHtml, css, script, bgmUi] = await Promise.all([
    readFile(new URL('index.html', projectRoot), 'utf8'),
    readFile(new URL('style.css', projectRoot), 'utf8'),
    readFile(new URL('script.js', projectRoot), 'utf8'),
    readFile(new URL('src/bgm-ui.js', projectRoot), 'utf8'),
  ]);

  assert.match(documentHtml, /<button[^>]*class="bgm-toggle"[^>]*data-bgm-toggle[^>]*aria-pressed="true"/);
  assert.match(documentHtml, /<button[^>]*data-bgm-toggle[^>]*aria-label=/);
  assert.match(documentHtml, /<main id="app"[\s\S]*<\/main>\s*<button[^>]*data-bgm-toggle/);
  assert.match(script, /import\s*{\s*createAudioManager\s*}\s*from\s*['"]\.\/src\/audio-manager\.js['"]/);
  assert.match(script, /createAudioManager\(/);
  assert.match(script, /createBgmController\(/);
  assert.match(script, /\[data-bgm-toggle\]/);
  assert.match(script, /bgmController\.setRoute\(route\)/);
  assert.match(bgmUi, /startFromGesture\(/);
  assert.match(bgmUi, /enterFilm\(/);
  assert.match(bgmUi, /leaveFilm\(/);
  assert.match(bgmUi, /aria-pressed/);
  assert.match(css, /\.bgm-toggle\s*{[\s\S]*position:\s*fixed/);
  assert.match(css, /\.bgm-toggle\s*{[\s\S]*min-(?:width|height):\s*44px/);
  assert.match(css, /\.bgm-toggle:focus-visible/);
  assert.match(css, /\.bgm-toggle\s*{[\s\S]*env\(safe-area-inset-(?:right|bottom)\)/);
  assert.match(css, /\.bgm-toggle:disabled/);
});

test('film exit stays visible above video and recovery layers with a mobile-safe touch target', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const exitBlock = css.match(/\.film-exit\s*{([^}]*)}/)?.[1] ?? '';

  assert.match(exitBlock, /position:\s*(?:fixed|absolute)/);
  assert.match(exitBlock, /inset-(?:inline-end|right):\s*max\(/);
  assert.match(exitBlock, /inset-(?:block-start|top):\s*max\(/);
  assert.match(exitBlock, /min-(?:width|height):\s*44px/);
  assert.match(exitBlock, /z-index:\s*(?:[7-9]|[1-9]\d)/);
  assert.match(css, /\.film-video::\-webkit-media-controls-fullscreen-button\s*{\s*display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.film-exit/);
});

function createEventTarget() {
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
  };
}

function createBgmHarness({ enabled = true } = {}) {
  const documentTarget = createEventTarget();
  const button = {
    ...createEventTarget(),
    attributes: new Map(),
    disabled: false,
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name); },
    closest(selector) { return selector === '[data-bgm-toggle]' ? this : null; },
  };
  const state = { enabled, unavailable: false };
  const calls = { start: 0, toggle: 0, enter: 0, leave: 0 };
  const manager = {
    state: () => ({ ...state }),
    startFromGesture: () => { calls.start += 1; return true; },
    toggle: () => { calls.toggle += 1; state.enabled = !state.enabled; return true; },
    enterFilm: () => { calls.enter += 1; return true; },
    leaveFilm: () => { calls.leave += 1; return true; },
  };
  return { documentTarget, button, state, calls, manager };
}

test('BGM controller starts only the first non-toggle gesture and toggles button clicks once', async () => {
  let bgmUi;
  try {
    bgmUi = await import('../src/bgm-ui.js');
  } catch {
    bgmUi = {};
  }
  assert.equal(typeof bgmUi.createBgmController, 'function');

  const harness = createBgmHarness();
  const controller = bgmUi.createBgmController({
    document: harness.documentTarget,
    button: harness.button,
    manager: harness.manager,
  });
  controller.bind();
  harness.documentTarget.dispatch('pointerdown', { target: { closest: () => null } });
  harness.documentTarget.dispatch('keydown', { target: { closest: () => null } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.start, 1);

  const buttonHarness = createBgmHarness();
  const buttonController = bgmUi.createBgmController({
    document: buttonHarness.documentTarget,
    button: buttonHarness.button,
    manager: buttonHarness.manager,
  });
  buttonController.bind();
  buttonHarness.documentTarget.dispatch('pointerdown', { target: buttonHarness.button });
  buttonHarness.button.dispatch('click', { target: buttonHarness.button });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(buttonHarness.calls.start, 0);
  assert.equal(buttonHarness.calls.toggle, 1);
});

test('BGM controller enables stored-off music from its first button click after registering the gesture', async () => {
  const documentTarget = createEventTarget();
  const button = {
    ...createEventTarget(),
    attributes: new Map(),
    disabled: false,
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name); },
    closest(selector) { return selector === '[data-bgm-toggle]' ? this : null; },
  };
  const audio = {
    volume: 0,
    paused: true,
    playCalls: 0,
    pause() { this.paused = true; },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
  };
  const manager = createAudioManager({
    audio,
    storage: { getItem: (key) => key === BGM_PREFERENCE_KEY ? 'false' : null, setItem() {} },
    fade: async (player, target) => { player.volume = target; },
  });
  const controller = createBgmController({ document: documentTarget, button, manager });

  controller.bind();
  button.dispatch('click', { target: button });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(manager.state().enabled, true);
  assert.equal(manager.state().gestureReceived, true);
  assert.equal(audio.playCalls, 1);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
});

test('BGM controller bind is idempotent and its cleanup removes listeners', async () => {
  const harness = createBgmHarness();
  const controller = createBgmController({
    document: harness.documentTarget,
    button: harness.button,
    manager: harness.manager,
  });
  const cleanup = controller.bind();
  controller.bind();
  harness.button.dispatch('click', { target: harness.button });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.toggle, 1);

  cleanup();
  harness.documentTarget.dispatch('pointerdown', { target: { closest: () => null } });
  harness.button.dispatch('click', { target: harness.button });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.start, 0);
  assert.equal(harness.calls.toggle, 1);
});

test('BGM controller applies the newest route state and contains rejected audio actions', async () => {
  const { createBgmController } = await import('../src/bgm-ui.js');
  const harness = createBgmHarness();
  let settleFilm;
  const filmTransition = new Promise((resolve) => { settleFilm = resolve; });
  harness.manager.enterFilm = () => { harness.calls.enter += 1; return filmTransition.then(() => { harness.state.enabled = true; }); };
  harness.manager.leaveFilm = () => { harness.calls.leave += 1; harness.state.enabled = false; return true; };
  const controller = createBgmController({ document: harness.documentTarget, button: harness.button, manager: harness.manager });

  const staleFilm = controller.setRoute({ name: 'film' });
  await controller.setRoute({ name: 'intro' });
  assert.equal(harness.calls.enter, 1);
  assert.equal(harness.calls.leave, 1);
  assert.equal(harness.button.getAttribute('aria-pressed'), 'false');
  settleFilm();
  await staleFilm;
  assert.equal(harness.button.getAttribute('aria-pressed'), 'false');

  harness.manager.toggle = () => Promise.reject(new Error('audio unavailable'));
  assert.equal(await controller.toggle(), false);
  assert.equal(harness.button.getAttribute('aria-pressed'), 'true');
});

test('global music control sits at the lower inline start below modal chrome', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');

  assert.match(css, /\.bgm-toggle\s*{[\s\S]*inset-inline-start:\s*max\(18px,\s*env\(safe-area-inset-left\)\)/);
  assert.match(css, /\.bgm-toggle\s*{[\s\S]*inset-block-end:\s*max\(120px,\s*calc\(env\(safe-area-inset-bottom\)\s*\+\s*102px\)\)/);
  assert.match(css, /\.bgm-toggle\s*{[\s\S]*z-index:\s*50/);
  assert.match(css, /\.review-chapter-drawer\s*{[\s\S]*z-index:\s*60/);
  assert.match(css, /\.review-lightbox\s*{[\s\S]*z-index:\s*100/);
  assert.match(css, /\.archive-lightbox\s*{[\s\S]*z-index:\s*110/);
});
