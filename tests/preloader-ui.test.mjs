import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPreloaderMarkup,
  developedCardCount,
  formatBytes,
  preloadPhase,
} from '../src/preloader-ui.js';

test('preloader markup contains projector iris, glass reveal and real progress controls', () => {
  const markup = buildPreloaderMarkup([
    { path: 'assets/a.png', bytes: 1 },
    { path: 'assets/b.mp4', bytes: 2 },
  ]);
  assert.match(markup, /data-preload-iris/);
  assert.match(markup, /preload-lens-reveal/);
  assert.match(markup, /preload-lens/);
  assert.match(markup, /data-preload-percent/);
  assert.match(markup, /data-preload-bytes/);
  assert.match(markup, /data-preload-files/);
  assert.match(markup, /data-preload-retry/);
  assert.match(markup, /data-preload-skip/);
  assert.doesNotMatch(markup, /data-preload-film/);
  assert.doesNotMatch(markup, /preload-card/);
});

test('progress helpers map completed assets to cards and readable phases', () => {
  assert.equal(developedCardCount({ completedFiles: 138, totalFiles: 204 }, 28), 19);
  assert.equal(developedCardCount({ completedFiles: 204, totalFiles: 204 }, 28), 28);
  assert.equal(formatBytes(347_200_000), '347.2 MB');
  assert.equal(preloadPhase('assets/review-media/a.mp4'), '正在整理 · 复盘案例');
  assert.equal(preloadPhase('assets/canvas-images/a.png'), '正在整理 · 图片与提示词');
  assert.equal(preloadPhase('assets/video/full-film.mp4'), '正在整理 · 完整成片');
});

test('formal stylesheet defines projector iris, glass reveal and reduced motion', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.preload-iris-wrap/);
  assert.match(css, /\.preload-iris-core/);
  assert.match(css, /\.preload-lens-reveal/);
  assert.match(css, /clip-path:\s*circle/);
  assert.match(css, /\.preload-lens/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*preload-iris/);
  assert.doesNotMatch(css, /\.preload-film\s*\{/);
});

test('HTML paints a loader skeleton before module scripts execute', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const loader = html.indexOf('id="site-preloader"');
  const script = html.indexOf('src="script.js"');
  assert.ok(loader > -1);
  assert.ok(loader < script);
});
