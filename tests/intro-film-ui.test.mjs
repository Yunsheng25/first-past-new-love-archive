import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildFilmView,
  buildIntroView,
  buildPendingView,
  filmEndedDestination,
} from '../src/views.js';

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

test('intro view keeps the approved title hierarchy and every navigation item clickable', () => {
  // Task 5 intentionally keeps these approved top-level text links. They are
  // navigation, not the two post-film choice cards owned by a later task.
  const html = buildIntroView();

  assert.match(html, /初恋\s*·\s*旧爱\s*·\s*新欢/);
  assert.match(html, /MEMORY\s*<span[^>]*>·<\/span>\s*CHOICE\s*<span[^>]*>·<\/span>\s*AFTERWARDS/);
  assert.match(html, /FIRST LOVE/);
  assert.match(html, /PAST LOVE/);
  assert.match(html, /NEW LOVE/);
  assert.match(html, /每一段情感，都是时光里的一次遇见/);
  assert.match(html, /Like the first time, like the reunion, like what comes after\./);
  assert.match(html, /href="#film"[^>]*>\s*观看成片/);
  assert.match(html, /href="#archive"[^>]*>\s*制作档案/);
  assert.match(html, /href="#review"[^>]*>\s*复盘手记/);
  assert.match(html, /href="#about"[^>]*>\s*关于项目/);
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

  assert.match(html, /src="assets\/video\/full-film\.mp4"/);
  assert.match(html, /controls/);
  assert.match(html, /playsinline/);
  assert.doesNotMatch(html, /\bmuted\b/);
  assert.doesNotMatch(html, /\bloop\b/);
  assert.doesNotMatch(html, /autoplay/);
  assert.match(html, /href="#"[^>]*>[\s\S]*?返回片头<\/a>/);
  assert.doesNotMatch(html, />复盘手记</);
  assert.doesNotMatch(html, />提示词和图片</);
});

test('film ending stays on the film route for the later after-film task', () => {
  // Task 6 owns the #after transition and frame persistence. Task 5 must stay put.
  assert.equal(filmEndedDestination(), null);
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
  assert.match(script, /focusRenderedView\(app/);

  const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('script.js', projectRoot))], {
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});
