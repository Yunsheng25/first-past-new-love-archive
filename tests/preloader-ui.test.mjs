import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPreloaderMarkup,
  developedCardCount,
  formatBytes,
  preloadPhase,
} from '../src/preloader-ui.js';

test('preloader markup contains one film roll, real progress fields, retry and pointer layers', () => {
  const markup = buildPreloaderMarkup([
    { path: 'assets/a.png', bytes: 1 },
    { path: 'assets/b.mp4', bytes: 2 },
  ]);
  assert.equal((markup.match(/data-preload-film/g) ?? []).length, 1);
  assert.match(markup, /data-preload-percent/);
  assert.match(markup, /data-preload-bytes/);
  assert.match(markup, /data-preload-files/);
  assert.match(markup, /data-preload-retry/);
  assert.match(markup, /preload-ripple/);
  assert.match(markup, /assets\/a\.png/);
});

test('progress helpers map completed assets to cards and readable phases', () => {
  assert.equal(developedCardCount({ completedFiles: 138, totalFiles: 204 }, 28), 19);
  assert.equal(developedCardCount({ completedFiles: 204, totalFiles: 204 }, 28), 28);
  assert.equal(formatBytes(347_200_000), '347.2 MB');
  assert.equal(preloadPhase('assets/review-media/a.mp4'), '正在整理 · 复盘案例');
  assert.equal(preloadPhase('assets/canvas-images/a.png'), '正在整理 · 图片与提示词');
  assert.equal(preloadPhase('assets/video/full-film.mp4'), '正在整理 · 完整成片');
});

test('formal stylesheet defines developed darkroom cards, pointer ripple and reduced motion', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.preload-card\.is-developed/);
  assert.match(css, /\.preload-ripple/);
  assert.match(css, /--preload-pointer-x/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*preload-film/);
});

test('HTML paints a loader skeleton before module scripts execute', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const loader = html.indexOf('id="site-preloader"');
  const script = html.indexOf('src="script.js"');
  assert.ok(loader > -1);
  assert.ok(loader < script);
});
