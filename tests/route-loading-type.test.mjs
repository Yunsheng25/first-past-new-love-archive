import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildRouteLoadingType,
  routeLoadingWord,
} from '../src/route-loading-type.js';

test('archive loading uses the approved four-character word reveal and real count', () => {
  const html = buildRouteLoadingType({
    route: 'archive',
    ready: 42,
    total: 137,
  });

  assert.equal(routeLoadingWord('archive'), '画面就绪');
  assert.match(html, /PROMPT &amp; IMAGE ARCHIVE/);
  assert.match(html, /aria-label="画面就绪"/);
  assert.equal((html.match(/class="route-loading-character/g) ?? []).length, 4);
  assert.match(html, /042\s*\/\s*137/);
  assert.match(html, /读取目录[\s\S]*下载素材[\s\S]*解码画面[\s\S]*准备进入/);
});

test('review loading changes only route copy and never restores the removed subtitle', () => {
  const html = buildRouteLoadingType({
    route: 'review',
    ready: 0,
    total: 8,
  });

  assert.equal(routeLoadingWord('review'), '手记就绪');
  assert.match(html, /THE MAKING-OF NOTES/);
  assert.match(html, /aria-label="手记就绪"/);
  assert.match(html, /000\s*\/\s*008/);
  assert.doesNotMatch(html, /所有资源准备完成后|准备完成后|圆环|spinner/i);
});

test('persistent route failures keep the preparation view and expose retry without a skip action', () => {
  const html = buildRouteLoadingType({
    route: 'archive',
    ready: 136,
    total: 137,
    failed: 1,
  });

  assert.match(html, /data-route-loading-retry/);
  assert.match(html, /1 项画面暂未就绪/);
  assert.doesNotMatch(html, /跳过|直接进入/);
});

test('word-reveal CSS rises from below over a mouse-lit grid without a rotating loader', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(css, /\.route-loading-type\s*\{[^}]*--route-pointer-x:\s*50vw[^}]*background:\s*#080808/s);
  assert.match(css, /\.route-loading-grid\s*\{[^}]*linear-gradient[^}]*background-size:/s);
  assert.match(css, /\.route-loading-glow\s*\{[^}]*var\(--route-pointer-x\)[^}]*var\(--route-pointer-y\)/s);
  assert.match(css, /\.route-loading-character\s*\{[^}]*opacity:\s*\.08/s);
  assert.match(css, /\.route-loading-character\s*\{[^}]*transform:\s*translateY\(\.9em\)/s);
  assert.match(css, /\.route-loading-character\.is-awake\s*\{[^}]*opacity:\s*1/s);
  assert.match(css, /\.route-loading-character\.is-awake\s*\{[^}]*transform:\s*translateY\(0\)/s);
  assert.doesNotMatch(css, /\.route-loading-(spinner|iris|ring)/);
});
