import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.equal(filmEndedDestination(), null);
});

test('unimplemented navigation destinations are explicitly marked as pending', () => {
  const html = buildPendingView('archive-index');

  assert.match(html, /后续阶段/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /case-card|review-page/);
});

test('site shell is a module-driven, single-viewport application', async () => {
  const [documentHtml, css] = await Promise.all([
    readFile(new URL('index.html', projectRoot), 'utf8'),
    readFile(new URL('style.css', projectRoot), 'utf8'),
  ]);

  assert.match(documentHtml, /<main id="app"/);
  assert.match(documentHtml, /<script type="module" src="script\.js"><\/script>/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /\.intro-film[\s\S]*object-fit:\s*cover/);
  assert.match(css, /\.intro-film[\s\S]*opacity:\s*0\.6[0-8]/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
