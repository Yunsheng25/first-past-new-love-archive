import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildReviewPage } from '../src/review-reader.js';
import { buildFilmView, buildIntroView } from '../src/views.js';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const tunnel = await readFile(new URL('../src/archive-tunnel.js', import.meta.url), 'utf8');

test('large route media is never part of application boot', () => {
  assert.doesNotMatch(script, /preload-manifest|PRELOAD_ASSETS|preloadInBackground/);
  assert.doesNotMatch(script, /full-film\.mp4|review-media|canvas-images/);
});

test('film and intro use native non-blocking media loading', () => {
  assert.match(buildIntroView(), /preload="metadata"/);
  assert.match(buildFilmView(), /preload="metadata"/);
});

test('review page media stays lazy and metadata-only', () => {
  const chapter = {
    slug: 'chapter',
    title: '章节',
    pages: [[
      { type: 'image', src: 'assets/review-media/case.png', ref: 'case.png' },
      { type: 'video', src: 'assets/review-media/case.mp4', ref: 'case.mp4' },
    ]],
  };
  const html = buildReviewPage(
    { chapters: [chapter] },
    { chapter, chapterIndex: 0, pageIndex: 0, page: 1 },
  );
  const image = html.match(/<img\b[^>]*>/)?.[0] ?? '';
  const video = html.match(/<video\b[^>]*>/)?.[0] ?? '';
  assert.match(image, /loading="lazy"/);
  assert.match(image, /decoding="async"/);
  assert.match(video, /preload="metadata"/);
  assert.doesNotMatch(video, /autoplay/);
});

test('archive tunnel assigns image sources only inside its visible activation window', () => {
  assert.match(tunnel, /function activateImage/);
  assert.match(tunnel, /entry\.image\.src = entry\.occurrence\.src/);
  assert.match(tunnel, /approvedTunnelVisibleRange/);
  assert.ok(
    tunnel.indexOf('approvedTunnelVisibleRange') < tunnel.indexOf('activateImage(entry)'),
  );
});
