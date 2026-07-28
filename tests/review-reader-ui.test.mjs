import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  REVIEW_PROGRESS_KEY,
  bindReviewInteractions,
  buildReviewIndex,
  buildReviewPage,
  createFocusTrap,
  estimateReadingMinutes,
  mountReviewRoute,
  normalizeReviewTarget,
  peekReviewData,
  readReviewProgress,
  resetReviewDataCache,
  renderInlineMarkdown,
  loadReviewData,
  writeReviewProgress,
} from '../src/review-reader.js';
import { createReviewTurnController } from '../src/review-turn.js';

const projectRoot = new URL('../', import.meta.url);
const reviewData = JSON.parse(await readFile(new URL('data/review.json', projectRoot), 'utf8'));

function cssRule(css, selector) {
  const normalized = css.replaceAll('\r\n', '\n');
  const start = normalized.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule for ${selector}`);
  const bodyStart = start + selector.length + 2;
  return normalized.slice(bodyStart, normalized.indexOf('}', bodyStart));
}

function expectedSignature(chapter, pageIndex) {
  const collect = (blocks, prefix = '') => blocks.flatMap((block, index) => {
    const blockIndex = prefix ? `${prefix}-${index}` : index;
    return [{ type: block.type, blockIndex, src: block.src ?? '' }, ...collect(block.children ?? [], String(blockIndex))];
  });
  return collect(chapter.pages[pageIndex]);
}

function renderedSignature(html) {
  return [...html.matchAll(/<[^>]+data-block-type="([^"]+)"[^>]+data-block-index="([\d-]+)"[^>]*>/g)]
    .map((match) => ({
      type: match[1],
      blockIndex: match[2].includes('-') ? match[2] : Number(match[2]),
      src: match[0].match(/data-source="([^"]*)"/)?.[1] ?? '',
    }));
}

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('review data cache deduplicates successful loads and peeks the exact result', async () => {
  resetReviewDataCache();
  const data = { chapters: [] };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => data };
  };

  assert.equal(peekReviewData(fetchImpl), null);
  const [first, second] = await Promise.all([loadReviewData(fetchImpl), loadReviewData(fetchImpl)]);
  assert.equal(first, data);
  assert.equal(second, data);
  assert.equal(peekReviewData(fetchImpl), data);
  assert.equal(calls, 1);
});

test('review data cache isolates fetch implementations and retries failures', async () => {
  resetReviewDataCache();
  const firstData = { chapters: ['first'] };
  const secondData = { chapters: ['second'] };
  let firstCalls = 0;
  let failureCalls = 0;
  const firstFetch = async () => {
    firstCalls += 1;
    return { ok: true, json: async () => firstData };
  };
  const secondFetch = async () => ({ ok: true, json: async () => secondData });
  const failingThenWorkingFetch = async () => {
    failureCalls += 1;
    if (failureCalls === 1) throw new Error('offline');
    return { ok: true, json: async () => firstData };
  };

  await loadReviewData(firstFetch);
  await loadReviewData(secondFetch);
  await assert.rejects(loadReviewData(failingThenWorkingFetch), /offline/);
  assert.equal(peekReviewData(firstFetch), firstData);
  assert.equal(peekReviewData(secondFetch), secondData);
  assert.equal(peekReviewData(failingThenWorkingFetch), null);
  await loadReviewData(failingThenWorkingFetch);
  assert.equal(failureCalls, 2);
  assert.equal(firstCalls, 1);
});

test('forced and reset cache requests ignore late older completions', async () => {
  resetReviewDataCache();
  const oldRequest = deferred();
  const forcedRequest = deferred();
  let calls = 0;
  const fetchImpl = () => (calls += 1) === 1 ? oldRequest.promise : forcedRequest.promise;
  const oldLoad = loadReviewData(fetchImpl);
  const forcedLoad = loadReviewData(fetchImpl, { force: true });
  forcedRequest.resolve({ ok: true, json: async () => ({ version: 'new' }) });
  assert.deepEqual(await forcedLoad, { version: 'new' });
  oldRequest.resolve({ ok: true, json: async () => ({ version: 'old' }) });
  assert.deepEqual(await oldLoad, { version: 'old' });
  assert.deepEqual(peekReviewData(fetchImpl), { version: 'new' });

  const resetRequest = deferred();
  const resetFetch = () => resetRequest.promise;
  const resetLoad = loadReviewData(resetFetch);
  resetReviewDataCache();
  resetRequest.resolve({ ok: true, json: async () => ({ version: 'stale' }) });
  await resetLoad;
  assert.equal(peekReviewData(resetFetch), null);
  assert.equal(calls, 2);
});

test('review data cache is safe when no fetch implementation is available', async () => {
  resetReviewDataCache();
  assert.equal(peekReviewData(null), null);
  await assert.rejects(loadReviewData(null), /fetch implementation/i);
});

test('mount renders a cached route synchronously without a loading write', async () => {
  resetReviewDataCache();
  const fetchImpl = async () => ({ ok: true, json: async () => reviewData });
  await loadReviewData(fetchImpl);
  const writes = [];
  const app = {
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, focus() {},
  };
  Object.defineProperty(app, 'innerHTML', { set(value) { writes.push(value); }, get() { return writes.at(-1) ?? ''; } });

  mountReviewRoute(app, { name: 'review-page', chapter: 'production', page: 7 }, {
    fetchImpl, storage: fakeStorage(),
    documentRef: { addEventListener() {}, removeEventListener() {} }, windowRef: { location: {} },
  });

  assert.equal(writes.length, 1);
  assert.match(writes[0], /data-review-page/);
  assert.doesNotMatch(writes[0], /data-review-loading/);
});

test('mount cold load shows loading and retry forces a fresh request', async () => {
  resetReviewDataCache();
  let calls = 0;
  const retryButton = { addEventListener(type, handler) { this.handler = handler; }, removeEventListener() {} };
  const app = {
    innerHTML: '', querySelector(selector) { return selector === '[data-retry-review]' ? retryButton : null; },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {}, focus() {},
  };
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return { ok: true, json: async () => reviewData };
  };
  mountReviewRoute(app, { name: 'review-index' }, {
    fetchImpl, storage: fakeStorage(),
    documentRef: { addEventListener() {}, removeEventListener() {} }, windowRef: { location: {} },
  });
  assert.match(app.innerHTML, /data-review-loading/);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /data-review-error/);
  retryButton.handler();
  assert.match(app.innerHTML, /data-review-loading/);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.match(app.innerHTML, /review-index-view/);
});

test('an active AbortError renders retry UI and a stale AbortError after cleanup is inert', async () => {
  resetReviewDataCache();
  let calls = 0;
  const retryButton = { addEventListener(type, handler) { this.handler = handler; }, removeEventListener() {} };
  const app = {
    innerHTML: '', querySelector(selector) { return selector === '[data-retry-review]' ? retryButton : null; },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {}, focus() {},
  };
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { ok: true, json: async () => reviewData };
  };
  mountReviewRoute(app, { name: 'review-index' }, {
    fetchImpl, storage: fakeStorage(),
    documentRef: { addEventListener() {}, removeEventListener() {} }, windowRef: { location: {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /data-review-error/);
  retryButton.handler();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.match(app.innerHTML, /review-index-view/);

  resetReviewDataCache();
  const request = deferred();
  const staleApp = { innerHTML: '', querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {}, focus() {} };
  const cleanup = mountReviewRoute(staleApp, { name: 'review-index' }, {
    fetchImpl: () => request.promise, storage: fakeStorage(),
    documentRef: { addEventListener() {}, removeEventListener() {} }, windowRef: { location: {} },
  });
  cleanup();
  staleApp.innerHTML = '<p>current route</p>';
  request.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleApp.innerHTML, '<p>current route</p>');
});

test('a malformed cached payload renders retry UI and a forced retry recovers', async () => {
  resetReviewDataCache();
  let calls = 0;
  let cached = true;
  const routeFetch = async () => {
    calls += 1;
    return { ok: true, json: async () => (cached ? {} : reviewData) };
  };
  await loadReviewData(routeFetch);
  cached = false;
  const retryButton = { addEventListener(type, handler) { this.handler = handler; }, removeEventListener() {} };
  const app = {
    innerHTML: '', querySelector(selector) { return selector === '[data-retry-review]' ? retryButton : null; },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {}, focus() {},
  };
  mountReviewRoute(app, { name: 'review-index' }, {
    fetchImpl: routeFetch, storage: fakeStorage(),
    documentRef: { addEventListener() {}, removeEventListener() {} }, windowRef: { location: {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /data-review-error/);
  retryButton.handler();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.match(app.innerHTML, /review-index-view/);
});

test('review index renders all five chapters and every generated page in source JSON order', () => {
  const html = buildReviewIndex(reviewData, null);
  const renderedTitles = [...html.matchAll(/data-review-chapter-title>([^<]+)</g)].map((match) => match[1]);

  assert.equal(reviewData.chapters.length, 5);
  const totalPages = reviewData.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);
  assert.ok(totalPages >= 27);
  assert.match(html, new RegExp(`${totalPages} PAGES`));
  assert.deepEqual(renderedTitles, reviewData.chapters.map((chapter) => chapter.title));
  assert.match(html, /href="#review\/origin\/1"[^>]*data-start-review/);
  assert.match(html, /href="#after"[^>]*data-return-after/);
  assert.doesNotMatch(html, /data-continue-review/);
});

test('review index exposes a valid saved continuation without changing chapter order', () => {
  const html = buildReviewIndex(reviewData, { chapter: 'production', page: 7, updatedAt: '2026-07-19T00:00:00.000Z' });

  assert.match(html, /href="#review\/production\/7"[^>]*data-continue-review/);
  assert.match(html, /继续阅读/);
});

test('review index estimates chapter reading time from that chapter text and headings', () => {
  const flatten = (blocks) => blocks.flatMap((block) => [block, ...flatten(block.children ?? [])]);
  const expected = reviewData.chapters.map((chapter) => {
    const chineseCharacters = flatten(chapter.pages.flat())
      .filter((block) => block.type === 'text' || block.type === 'heading')
      .flatMap((block) => [...block.text.matchAll(/[\u3400-\u9fff]/g)])
      .length;
    return Math.max(1, Math.ceil(chineseCharacters / 400));
  });
  const html = buildReviewIndex(reviewData, null);
  const rendered = [...html.matchAll(/data-reading-time="(\d+)"/g)].map((match) => Number(match[1]));

  assert.deepEqual(reviewData.chapters.map(estimateReadingMinutes), expected);
  assert.deepEqual(rendered, expected);
  expected.forEach((minutes) => assert.match(html, new RegExp(`约${minutes}分钟`)));
});

test('review index uses one numbered directory rule without chapter previews', () => {
  const html = buildReviewIndex(reviewData, null);
  const numbers = [...html.matchAll(/class="review-index-number">(\d{2})</g)]
    .map((match) => match[1]);
  assert.deepEqual(numbers, ['01', '02', '03', '04', '05']);
  assert.doesNotMatch(html, /review-index-preview/);
  assert.doesNotMatch(html, /data-chapter-preview|data-chapter-placeholder/);
  assert.doesNotMatch(html, /<img\b[^>]*loading="lazy"/);
});

test('every rendered page has exactly the independent source block signature', () => {
  let renderedCount = 0;
  let expectedCount = 0;

  for (const chapter of reviewData.chapters) {
    chapter.pages.forEach((page, pageIndex) => {
      const html = buildReviewPage(reviewData, { chapter, pageIndex });
      const actual = renderedSignature(html);
      const expected = expectedSignature(chapter, pageIndex);
      assert.deepEqual(actual, expected, `${chapter.slug} page ${pageIndex + 1}`);
      renderedCount += actual.length;
      expectedCount += expected.length;
    });
  }

  assert.ok(expectedCount > 0);
  assert.equal(renderedCount, expectedCount);
});

test('all 51 media occurrences render in place and both duplicate occurrences remain', () => {
  const flatten = (blocks) => blocks.flatMap((block) => [block, ...flatten(block.children ?? [])]);
  const expectedMedia = flatten(reviewData.chapters.flatMap((chapter) => chapter.pages.flat()))
    .filter((block) => block.type === 'image' || block.type === 'video')
    .map((block) => `${block.type}:${block.src}`);
  const renderedMedia = [];

  for (const chapter of reviewData.chapters) {
    chapter.pages.forEach((page, pageIndex) => {
      const html = buildReviewPage(reviewData, { chapter, pageIndex });
      for (const match of html.matchAll(/data-block-type="(image|video)"[^>]+data-block-index="[\d-]+"[^>]+data-source="([^"]+)"/g)) {
        renderedMedia.push(`${match[1]}:${match[2]}`);
      }
    });
  }

  const counts = new Map();
  expectedMedia.forEach((entry) => counts.set(entry, (counts.get(entry) ?? 0) + 1));
  assert.equal(expectedMedia.length, 51);
  assert.equal(new Set(expectedMedia).size, 49);
  assert.equal([...counts.values()].filter((count) => count === 2).length, 2);
  assert.deepEqual(renderedMedia, expectedMedia);
});

test('chapter title is an opener-only heading and a heading-led continuation uses its section heading', () => {
  const chapter = reviewData.chapters.find((item) => item.slug === 'production');
  const continuationIndex = chapter.pages.findIndex((page, index) => index > 0 && page[0]?.type === 'heading');
  assert.ok(continuationIndex > 0);
  const opener = buildReviewPage(reviewData, normalizeReviewTarget(reviewData, chapter.slug, 1));
  const continuation = buildReviewPage(reviewData, normalizeReviewTarget(reviewData, chapter.slug, continuationIndex + 1));

  assert.match(opener, /<article class="review-paper-content review-chapter-opener"[^>]*data-review-page="opener"/);
  assert.match(opener, /<h1 id="review-reader-title">/);
  assert.match(continuation, /<article class="review-paper-content"[^>]*data-review-page="continuation"[^>]*aria-labelledby="review-section-title"/);
  assert.doesNotMatch(continuation, /review-chapter-opener/);
  assert.doesNotMatch(continuation, /<h1 id="review-reader-title">/);
  assert.match(continuation, /<h[3-5] class="review-block review-heading" data-block-type="heading" data-block-index="0" id="review-section-title">/);
  assert.match(continuation, /<div class="review-blocks" aria-labelledby="review-section-title">/);
  assert.deepEqual(renderedSignature(continuation), expectedSignature(chapter, continuationIndex));
});

test('split continuation uses a page label instead of a later heading', () => {
  const chapter = reviewData.chapters.find((item) => item.slug === 'production');
  const html = buildReviewPage(reviewData, normalizeReviewTarget(reviewData, chapter.slug, 2));
  const laterHeadingIndex = chapter.pages[1].findIndex((block) => block.type === 'heading');

  assert.ok(laterHeadingIndex > 0);
  assert.match(html, /<article class="review-paper-content"[^>]*data-review-page="continuation"[^>]*aria-label="[^"]+"/);
  assert.doesNotMatch(html, /review-section-title/);
  assert.doesNotMatch(html, /<div class="review-blocks"[^>]*aria-labelledby/);
  assert.match(html, new RegExp(`data-block-index="${laterHeadingIndex}"(?![^>]*review-section-title)`));
  assert.deepEqual(renderedSignature(html), expectedSignature(chapter, 1));
});

test('headingless continuation has an article label without a dangling section reference', () => {
  const chapter = reviewData.chapters.find((item) => item.slug === 'origin');
  const html = buildReviewPage(reviewData, normalizeReviewTarget(reviewData, chapter.slug, 2));

  assert.match(html, /<article class="review-paper-content"[^>]*data-review-page="continuation"[^>]*aria-label="[^"]+"/);
  assert.doesNotMatch(html, /review-section-title/);
  assert.doesNotMatch(html, /<div class="review-blocks"[^>]*aria-labelledby/);
  assert.deepEqual(renderedSignature(html), expectedSignature(chapter, 1));
});

test('images and videos use safe, non-autoplay case-media attributes', () => {
  const chapter = reviewData.chapters.find((item) => item.slug === 'production');
  const html = chapter.pages.map((page, pageIndex) => buildReviewPage(reviewData, { chapter, pageIndex })).join('');

  assert.match(html, /<img\b[^>]*loading="lazy"[^>]*data-lightbox-image/);
  assert.match(html, /<video\b[^>]*controls[^>]*preload="metadata"[^>]*playsinline[^>]*>/);
  assert.match(html, /data-occurrence="production-p\d+-b\d+"/);
  assert.doesNotMatch(html, /<video\b[^>]*\bautoplay\b/);
  assert.doesNotMatch(html, /<video\b[^>]*\bloop\b/);
});

test('target normalization clamps pages and navigation crosses chapter boundaries', () => {
  const first = normalizeReviewTarget(reviewData, 'origin', 1);
  const endOfOrigin = normalizeReviewTarget(reviewData, 'origin', 99);
  const startOfStory = normalizeReviewTarget(reviewData, 'story', -4);

  assert.equal(first.previousHref, null);
  assert.equal(first.nextHref, '#review/origin/2');
  assert.equal(endOfOrigin.pageIndex, 2);
  assert.equal(endOfOrigin.nextHref, '#review/story/1');
  assert.equal(startOfStory.pageIndex, 0);
  assert.equal(startOfStory.previousHref, '#review/origin/3');
  assert.equal(normalizeReviewTarget(reviewData, 'missing', 1), null);
});

test('page targets and reader chrome show overall and within-chapter page positions', () => {
  const storyStart = normalizeReviewTarget(reviewData, 'story', 1);
  const productionMiddle = normalizeReviewTarget(reviewData, 'production', 7);
  const reflectionStart = normalizeReviewTarget(reviewData, 'reflection', 1);

  assert.equal(storyStart.overallPage, reviewData.chapters[0].pages.length + 1);
  assert.equal(productionMiddle.overallPage, reviewData.chapters.slice(0, 2)
    .reduce((sum, chapter) => sum + chapter.pages.length, 0) + 7);
  assert.equal(reflectionStart.overallPage, reviewData.chapters.slice(0, 3)
    .reduce((sum, chapter) => sum + chapter.pages.length, 0) + 1);
  assert.equal(productionMiddle.totalPages, reviewData.chapters
    .reduce((sum, chapter) => sum + chapter.pages.length, 0));
  const html = buildReviewPage(reviewData, productionMiddle);
  assert.match(html, new RegExp(`全篇\\s*${productionMiddle.overallPage}\\s*\\/\\s*${productionMiddle.totalPages}`));
  assert.match(html, new RegExp(`本章\\s*7\\s*\\/\\s*${productionMiddle.chapter.pages.length}`));
  assert.match(html, /class="review-chapter-drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/);
});

test('inline markdown escapes HTML before applying the supported subset', () => {
  const html = renderInlineMarkdown('<img src=x onerror=alert(1)> **粗体** *斜体* `代码`');

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.doesNotMatch(html, /<img\b/);
});

test('Obsidian NOTE blocks remain readable callouts', () => {
  const chapter = reviewData.chapters.find((item) => item.slug === 'production');
  const pageIndex = chapter.pages.findIndex((page) => page.some((block) => block.type === 'callout'));
  const html = buildReviewPage(reviewData, { chapter, pageIndex });

  assert.match(html, /class="[^"]*\breview-callout\b[^"]*"/);
  assert.match(html, />批注<\/span>/);
  assert.doesNotMatch(html, /\[!NOTE\]/);
  assert.doesNotMatch(html, /NaN/);
});

test('structured review annotations render one escaped, ordered and complete frame', () => {
  const callout = {
    type: 'callout',
    kind: 'NOTE',
    title: '<原始标题>',
    section: '制作执行',
    contextHeading: { type: 'heading', text: '案例上下文', level: 3, section: '制作执行' },
    oversized: true,
    scrollable: true,
    children: [
      { type: 'text', text: '第一段说明', section: '制作执行' },
      { type: 'image', rawRef: 'first.png', ref: 'first.png', src: 'assets/first.png', section: '制作执行' },
      { type: 'text', text: '中间标注', section: '制作执行' },
      { type: 'video', rawRef: 'result.mp4', ref: 'result.mp4', src: 'assets/result.mp4', section: '制作执行' },
    ],
  };
  const data = { chapters: [{ slug: 'sample', title: '示例', summary: '', pages: [[callout]] }] };
  const html = buildReviewPage(data, normalizeReviewTarget(data, 'sample', 1));

  assert.equal((html.match(/<aside\b[^>]*\breview-callout\b/g) ?? []).length, 1);
  assert.match(html, /<span class="review-callout-label">批注<\/span>/);
  assert.match(html, /<strong class="review-callout-title" id="[^"]+">&lt;原始标题&gt;<\/strong>/);
  assert.match(html, /class="review-callout-context"[^>]*>案例上下文</);
  assert.match(html, /<aside\b[^>]*\breview-callout\b[^>]*\bis-oversized\b[^>]*data-scrollable="true"/);
  const calloutStart = html.indexOf('<aside class="review-block review-callout');
  const aside = html.slice(calloutStart, html.indexOf('</aside>', calloutStart) + '</aside>'.length);
  const order = ['第一段说明', 'assets/first.png', '中间标注', 'assets/result.mp4'].map((value) => aside.indexOf(value));
  assert.equal(order.every((position) => position >= 0), true);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(html.replace(aside, '').includes('assets/first.png'), false);
  assert.equal(html.replace(aside, '').includes('assets/result.mp4'), false);
});

test('annotation CSS scrolls only the oversized body and never fades its media', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const frame = cssRule(css, '.review-callout');
  const body = cssRule(css, '.review-callout.is-oversized .review-callout-body');
  const media = cssRule(css, '.review-callout .review-media img,\n.review-callout .review-media video');

  assert.match(frame, /background:\s*rgba\(/);
  assert.match(frame, /border:\s*1px solid rgba\(/);
  assert.doesNotMatch(frame, /overflow(?:-y)?:\s*(?:auto|scroll)/);
  assert.match(body, /max-height:\s*(?:min|clamp)\(/);
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(media, /opacity:\s*1/);
  assert.match(media, /filter:\s*none/);
});

test('only oversized annotation bodies are named keyboard-scroll regions with unique safe title ids', () => {
  const callout = (title, oversized) => ({
    type: 'callout', kind: 'NOTE', title, oversized, scrollable: oversized,
    children: [{ type: 'text', text: '内容' }],
  });
  const data = {
    chapters: [{
      slug: 'sample"><unsafe', title: '示例', summary: '',
      pages: [[callout('<标题一>', true), callout('<标题二>', true), callout('普通', false)]],
    }],
  };
  const html = buildReviewPage(data, normalizeReviewTarget(data, 'sample"><unsafe', 1));
  const titleIds = [...html.matchAll(/class="review-callout-title" id="([^"]+)"/g)].map((match) => match[1]);
  const bodies = [...html.matchAll(/<div class="review-callout-body"([^>]*)>/g)].map((match) => match[1]);

  assert.equal(new Set(titleIds).size, 3);
  assert.ok(titleIds.every((id) => !/[<>"']/.test(id)));
  assert.match(html, /class="review-callout-title" id="[^"]+">&lt;标题一&gt;<\/strong>/);
  assert.match(bodies[0], /tabindex="0"/);
  assert.match(bodies[0], /role="region"/);
  assert.match(bodies[0], new RegExp(`aria-labelledby="${titleIds[0]}"`));
  assert.match(bodies[1], new RegExp(`aria-labelledby="${titleIds[1]}"`));
  assert.doesNotMatch(bodies[2], /tabindex=|role=|aria-labelledby=/);
});

test('progress stores only chapter, page, and updatedAt and survives denied storage', () => {
  const storage = fakeStorage();
  assert.equal(writeReviewProgress(storage, { chapter: 'story', page: 2 }, new Date('2026-07-19T12:00:00.000Z')), true);
  const raw = JSON.parse(storage.getItem(REVIEW_PROGRESS_KEY));
  assert.deepEqual(Object.keys(raw).sort(), ['chapter', 'page', 'updatedAt']);
  assert.deepEqual(readReviewProgress(storage), raw);

  const denied = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => readReviewProgress(denied));
  assert.equal(readReviewProgress(denied), null);
  assert.doesNotThrow(() => writeReviewProgress(denied, { chapter: 'story', page: 2 }));
  assert.equal(writeReviewProgress(denied, { chapter: 'story', page: 2 }), false);
});

test('leaving an async review load prevents stale HTML from replacing the next route', async () => {
  const request = deferred();
  const app = {
    innerHTML: '',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  };
  const cleanup = mountReviewRoute(app, { name: 'review-index' }, {
    fetchImpl: () => request.promise,
    storage: fakeStorage(),
    documentRef: { addEventListener() {}, removeEventListener() {} },
    windowRef: { location: { hash: '#review' } },
  });
  assert.match(app.innerHTML, /data-review-loading/);

  cleanup();
  app.innerHTML = '<p>current route</p>';
  request.resolve({ ok: true, json: async () => reviewData });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.innerHTML, '<p>current route</p>');
});

test('review interaction cleanup pauses all case videos and removes keyboard handling', () => {
  const videos = [{ paused: 0, pause() { this.paused += 1; } }, { paused: 0, pause() { this.paused += 1; } }];
  const documentListeners = new Map();
  const rootListeners = new Map();
  const root = {
    addEventListener(type, fn) { rootListeners.set(type, fn); },
    removeEventListener(type, fn) { if (rootListeners.get(type) === fn) rootListeners.delete(type); },
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === '.review-media-video' ? videos : []; },
  };
  const documentRef = {
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    removeEventListener(type, fn) { if (documentListeners.get(type) === fn) documentListeners.delete(type); },
  };
  const cleanup = bindReviewInteractions(root, { documentRef, windowRef: { location: {} } });
  assert.equal(documentListeners.has('keydown'), true);
  cleanup();
  assert.deepEqual(videos.map((video) => video.paused), [1, 1]);
  assert.equal(documentListeners.has('keydown'), false);
  assert.equal(rootListeners.has('click'), false);
});

test('mobile chapter drawer traps an intentional focus cycle and cleanup never restores stale focus', () => {
  function focusable(name) {
    const attributes = new Map();
    return {
      name,
      focusCount: 0,
      focus() { this.focusCount += 1; },
      setAttribute(key, value) { attributes.set(key, value); },
      getAttribute(key) { return attributes.get(key); },
    };
  }

  const toggle = focusable('toggle');
  const close = focusable('close');
  const firstLink = focusable('first-link');
  const drawerAttributes = new Map([['aria-hidden', 'true']]);
  const drawer = {
    hidden: true,
    classList: { contains() { return false; }, toggle() {} },
    setAttribute(key, value) { drawerAttributes.set(key, value); },
    getAttribute(key) { return drawerAttributes.get(key); },
    querySelector(selector) {
      if (selector === '[data-close-review-drawer]') return close;
      if (selector === '.review-chapter-link') return firstLink;
      return null;
    },
  };
  const rootListeners = new Map();
  const documentListeners = new Map();
  const root = {
    addEventListener(type, fn) { rootListeners.set(type, fn); },
    removeEventListener(type, fn) { if (rootListeners.get(type) === fn) rootListeners.delete(type); },
    querySelector(selector) {
      if (selector === '[data-review-drawer]') return drawer;
      if (selector === '[data-toggle-review-drawer]') return toggle;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const documentRef = {
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    removeEventListener(type, fn) { if (documentListeners.get(type) === fn) documentListeners.delete(type); },
  };
  const clickTarget = (selector) => ({ closest(query) { return query === selector ? this : null; } });
  const cleanup = bindReviewInteractions(root, { documentRef, windowRef: { location: {} } });

  rootListeners.get('click')({ target: clickTarget('[data-toggle-review-drawer]') });
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.getAttribute('aria-hidden'), 'false');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(close.focusCount + firstLink.focusCount, 1);

  documentListeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(drawer.hidden, true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.focusCount, 1);

  rootListeners.get('click')({ target: clickTarget('[data-toggle-review-drawer]') });
  cleanup();
  assert.equal(documentListeners.has('keydown'), false);
  assert.equal(toggle.focusCount, 1, 'route cleanup must not return focus into stale markup');
});

test('reusable focus trap cycles drawer links in both Tab directions and restores its trigger', () => {
  const documentRef = { activeElement: null };
  const focusable = (name) => ({
    name,
    focusCount: 0,
    focus() { this.focusCount += 1; documentRef.activeElement = this; },
    getAttribute() { return null; },
  });
  const trigger = focusable('trigger');
  const close = focusable('close');
  const chapterLinks = Array.from({ length: 5 }, (_, index) => focusable(`chapter-${index + 1}`));
  const all = [close, ...chapterLinks];
  const drawer = { querySelectorAll() { return all; } };
  const trap = createFocusTrap(drawer, { documentRef });

  trap.activate({ returnFocus: trigger, initialFocus: close });
  assert.equal(documentRef.activeElement, close);

  documentRef.activeElement = chapterLinks[4];
  let prevented = 0;
  assert.equal(trap.handleKeydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented += 1; } }), true);
  assert.equal(documentRef.activeElement, close);

  documentRef.activeElement = close;
  assert.equal(trap.handleKeydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented += 1; } }), true);
  assert.equal(documentRef.activeElement, chapterLinks[4]);
  assert.equal(prevented, 2);

  trap.deactivate();
  assert.equal(documentRef.activeElement, trigger);
});

test('focus trap keeps Tab and Shift+Tab on the only lightbox close control', () => {
  const documentRef = { activeElement: null };
  const trigger = { focusCount: 0, focus() { this.focusCount += 1; documentRef.activeElement = this; } };
  const close = {
    focusCount: 0,
    focus() { this.focusCount += 1; documentRef.activeElement = this; },
    getAttribute() { return null; },
  };
  const trap = createFocusTrap({ querySelectorAll: () => [close] }, { documentRef });
  trap.activate({ returnFocus: trigger, initialFocus: close });

  for (const shiftKey of [false, true]) {
    let prevented = false;
    documentRef.activeElement = close;
    trap.handleKeydown({ key: 'Tab', shiftKey, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(documentRef.activeElement, close);
  }

  trap.deactivate({ restoreFocus: false });
  assert.equal(trigger.focusCount, 0);
});

test('reader CSS keeps one route page inside a 100dvh shell with an internal scroll region', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');

  assert.match(css, /\.review-reader-view[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.review-paper-scroll[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.review-reader-layout[\s\S]*min-height:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.review-chapter-drawer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.review-return-after[\s\S]*position:\s*(?:fixed|sticky)/);
  assert.match(css, /\.review-index-number[\s\S]*font:\s*300\s+clamp/);
  assert.match(css, /\.review-index-main[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(css, /\.review-index-list[\s\S]*min-height:\s*0[\s\S]*max-height:/);
  assert.match(css, /\.review-chapter-drawer[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(css, /@media\s*\(max-height:\s*650px\)[\s\S]*\.review-index-list/);
});

test('reader CSS uses the approved ink-gray palette in scoped reading rules', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const view = cssRule(css, '.review-reader-view');
  const paper = cssRule(css, '.review-paper');
  const copy = cssRule(css, '.review-paragraph');
  const title = cssRule(css, '.review-paper-content > h1');
  const kicker = cssRule(css, '.review-paper-kicker');

  assert.match(view, /background:\s*#0d0c0b/);
  assert.match(paper, /background:\s*#151719/);
  assert.doesNotMatch(paper, /#(?:f[\da-f]{2}|fff(?:fff)?|e8e0d4)/i);
  assert.match(copy, /color:\s*#cdcdc9/);
  assert.match(title, /color:\s*#eee4d8/);
  assert.match(kicker, /color:\s*#aa8c77/);
});

test('reader CSS gives chapter openers a larger rhythm than continuation pages', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const opener = cssRule(css, '.review-chapter-opener');
  const continuation = cssRule(css, 'article[data-review-page="continuation"]');

  const openerPadding = Number(opener.match(/padding-top:\s*(\d+)px/)?.[1]);
  const continuationPadding = Number(continuation.match(/padding-top:\s*(\d+)px/)?.[1]);
  assert.ok(openerPadding > continuationPadding, 'chapter opener padding must exceed continuation padding');
  assert.match(cssRule(css, '.review-chapter-opener > h1'), /font-size:\s*clamp\(/);
  assert.match(cssRule(css, '.review-heading'), /font-size:\s*clamp\(18px/);
});

test('reader media elements remain fully opaque and unfiltered', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const media = cssRule(css, '.review-media img,\n.review-media video');

  assert.match(media, /opacity:\s*1/);
  assert.match(media, /filter:\s*none/);
  const mediaRules = [...css.matchAll(/\.review-media(?:\s+img|\s+video|\s+img,\s*\.review-media\s+video)[^{]*\{([^}]*)\}/g)];
  assert.ok(mediaRules.length >= 1);
  for (const [, body] of mediaRules) {
    for (const [, value] of body.matchAll(/opacity\s*:\s*([^;]+);?/g)) assert.equal(value.trim(), '1');
    for (const [, value] of body.matchAll(/filter\s*:\s*([^;]+);?/g)) assert.equal(value.trim(), 'none');
  }
});

test('sidebar page counts stay readable against the warm-charcoal sidebar', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const count = cssRule(css, '.review-chapter-link small');

  assert.match(count, /font-size:\s*(?:11|12)px/);
  assert.match(count, /color:\s*#c9beb2/);
});

test('reader content surfaces use scoped warm-charcoal treatments', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const blockquote = cssRule(css, '.review-paper-content blockquote');
  const pre = cssRule(css, '.review-paper-content pre');
  const table = cssRule(css, '.review-paper-content table');
  const headingCell = cssRule(css, '.review-paper-content th');
  const dataCell = cssRule(css, '.review-paper-content td');

  assert.match(blockquote, /background:\s*#211c18/);
  assert.match(blockquote, /border-left:\s*3px solid #aa8c77/);
  assert.match(pre, /background:\s*#171412/);
  assert.match(pre, /overflow-x:\s*auto/);
  assert.match(table, /display:\s*block/);
  assert.match(table, /overflow-x:\s*auto/);
  assert.match(headingCell, /background:\s*#211c18/);
  assert.match(headingCell, /color:\s*#eee4d8/);
  assert.match(dataCell, /border:\s*1px solid rgba\(170, 140, 119, 0\.24\)/);
  assert.match(dataCell, /color:\s*#c9beb2/);
});

test('review status shell and actions use the exact warm-charcoal system', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  const status = cssRule(css, '.review-status-view');
  const actions = cssRule(css, '.review-status-view a,\n.review-status-view button');

  assert.match(status, /background:\s*#0d0c0b/);
  assert.match(status, /color:\s*#c9beb2/);
  assert.match(actions, /background:\s*#211c18/);
  assert.match(actions, /color:\s*#eee4d8/);
  assert.match(actions, /min-height:\s*44px/);
});

test('script routes both review destinations through cancellable review mounting', async () => {
  const script = await readFile(new URL('script.js', projectRoot), 'utf8');

  assert.match(script, /mountReviewRoute/);
  assert.match(script, /route\.name === 'review-index'/);
  assert.match(script, /route\.name === 'review-page'/);
  assert.match(script, /currentViewCleanup\s*=\s*mountRouteInteractions\(mountReviewRoute/);
  assert.match(script, /currentViewCleanup\(\)/);
  assert.match(script, /getRoute:\s*currentRoute/);
});

test('review page links declare their actual turn direction', () => {
  const target = normalizeReviewTarget(reviewData, reviewData.chapters[0].slug, 2);
  const html = buildReviewPage(reviewData, target);
  assert.match(html, /data-review-prev[^>]*data-review-direction="previous"/);
  assert.match(html, /data-review-next[^>]*data-review-direction="next"/);
});

function reviewRoute(page) { return { name: 'review-page', chapter: 'story', page }; }

function turnHarness({ cached = true, reducedMotion = false, transition, timers = null } = {}) {
  const classes = new Set();
  const documentRef = {
    documentElement: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } },
    startViewTransition: transition,
  };
  const windowRef = { location: { hash: '#review/story/1' } };
  const rendered = [];
  const controller = createReviewTurnController({
    documentRef, windowRef,
    getRoute: () => reviewRoute(Number(windowRef.location.hash.split('/').at(-1))),
    renderRoute: (route) => rendered.push(route),
    peekReviewData: () => cached ? {} : null,
    reducedMotion: () => reducedMotion,
    setTimeoutFn: timers?.setTimeout ?? setTimeout,
    clearTimeoutFn: timers?.clearTimeout ?? clearTimeout,
  });
  controller.renderInitial(reviewRoute(1));
  return { controller, windowRef, rendered, classes };
}

test('hash changes use the wrapped current route resolver for #about', () => {
  const rendered = [];
  const windowRef = { location: { hash: '#review/story/1' } };
  const controller = createReviewTurnController({
    documentRef: { documentElement: { classList: { add() {}, remove() {} } } },
    windowRef,
    getRoute: () => windowRef.location.hash === '#about' ? { name: 'about' } : reviewRoute(1),
    renderRoute: (route) => rendered.push(route),
    peekReviewData: () => null,
  });
  controller.renderInitial(reviewRoute(1));
  windowRef.location.hash = '#about';
  controller.handleHashChange();
  assert.deepEqual(rendered.at(-1), { name: 'about' });
});

test('cached forward review navigation renders inside a view transition and cleans its direction class', async () => {
  let update;
  let finish;
  const transition = (callback) => { update = callback; return { finished: new Promise((resolve) => { finish = resolve; }) }; };
  const { controller, windowRef, rendered, classes } = turnHarness({ transition });
  controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'next' } }) } });
  windowRef.location.hash = '#review/story/2';
  controller.handleHashChange();
  assert.equal(rendered.length, 1);
  assert.equal(classes.has('review-turn-next'), true);
  update();
  assert.deepEqual(rendered.at(-1), reviewRoute(2));
  finish();
  await Promise.resolve();
  assert.equal(classes.has('review-turn-next'), false);
});

test('previous review turns are symmetric and all unsafe cases render normally', () => {
  const calls = [];
  const transition = (callback) => { calls.push(callback); return { finished: Promise.resolve() }; };
  const previous = turnHarness({ transition });
  previous.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'previous' } }) } });
  previous.windowRef.location.hash = '#review/story/2';
  previous.controller.handleHashChange();
  assert.equal(previous.classes.has('review-turn-previous'), true);
  calls[0]();
  for (const options of [{ cached: false, transition }, { reducedMotion: true, transition }, {}]) {
    const harness = turnHarness(options);
    harness.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'next' } }) } });
    harness.windowRef.location.hash = '#review/story/2';
    harness.controller.handleHashChange();
    assert.deepEqual(harness.rendered.at(-1), reviewRoute(2));
  }
});

test('modifier and middle review clicks do not record page-turn intent', () => {
  const harness = turnHarness({ transition: () => { throw new Error('must not transition'); } });
  const target = { closest: () => ({ dataset: { reviewDirection: 'next' } }) };
  harness.controller.recordIntent({ button: 1, target });
  harness.controller.recordIntent({ button: 0, metaKey: true, target });
  harness.windowRef.location.hash = '#review/story/2';
  harness.controller.handleHashChange();
  assert.deepEqual(harness.rendered.at(-1), reviewRoute(2));
});

test('a rejected or stalled transition releases the turn class without unhandled state', async () => {
  let reject;
  const rejected = turnHarness({ transition: () => ({ finished: new Promise((_, fail) => { reject = fail; }) }) });
  rejected.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'next' } }) } });
  rejected.windowRef.location.hash = '#review/story/2';
  rejected.controller.handleHashChange();
  reject(new Error('cancelled'));
  await Promise.resolve();
  assert.equal(rejected.classes.size, 0);

  let timeout;
  let lateUpdate;
  let skipped = 0;
  const stalled = turnHarness({
    transition: (callback) => {
      lateUpdate = callback;
      return { finished: new Promise(() => {}), skipTransition() { skipped += 1; } };
    },
    timers: { setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {} },
  });
  stalled.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'next' } }) } });
  stalled.windowRef.location.hash = '#review/story/2';
  stalled.controller.handleHashChange();
  timeout();
  assert.equal(stalled.classes.size, 0);
  assert.equal(skipped, 1);
  assert.deepEqual(stalled.rendered.at(-1), reviewRoute(2));
  assert.deepEqual(stalled.controller.currentRenderedRoute, reviewRoute(2));
  const renderCount = stalled.rendered.length;
  lateUpdate();
  assert.equal(stalled.rendered.length, renderCount);
});

test('destroy skips an active native review transition and makes its late update inert', () => {
  let lateUpdate;
  let skipped = 0;
  const harness = turnHarness({
    transition: (callback) => {
      lateUpdate = callback;
      return { finished: new Promise(() => {}), skipTransition() { skipped += 1; } };
    },
    timers: { setTimeout() { return 1; }, clearTimeout() {} },
  });
  harness.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'next' } }) } });
  harness.windowRef.location.hash = '#review/story/2';
  harness.controller.handleHashChange();
  harness.controller.destroy();
  assert.equal(skipped, 1);
  assert.equal(harness.classes.size, 0);
  const renderCount = harness.rendered.length;
  lateUpdate();
  assert.equal(harness.rendered.length, renderCount);
});

test('missing or throwing native skipTransition never prevents timeout cleanup', () => {
  let timeout;
  const harness = turnHarness({
    transition: () => ({ finished: new Promise(() => {}), skipTransition() { throw new Error('ignored'); } }),
    timers: { setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {} },
  });
  harness.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: 'next' } }) } });
  harness.windowRef.location.hash = '#review/story/2';
  harness.controller.handleHashChange();
  assert.doesNotThrow(timeout);
  assert.equal(harness.classes.size, 0);
});

test('rapid review hash changes coalesce to the latest page after the active turn', async () => {
  const updates = [];
  const finishes = [];
  const transition = (callback) => {
    updates.push(callback);
    return { finished: new Promise((resolve) => finishes.push(resolve)) };
  };
  const harness = turnHarness({ transition });
  const click = (direction) => harness.controller.recordIntent({ button: 0, target: { closest: () => ({ dataset: { reviewDirection: direction } }) } });
  click('next');
  harness.windowRef.location.hash = '#review/story/2';
  harness.controller.handleHashChange();
  updates[0]();
  click('next');
  harness.windowRef.location.hash = '#review/story/3';
  harness.controller.handleHashChange();
  finishes[0]();
  await Promise.resolve();
  updates[1]();
  assert.deepEqual(harness.controller.currentRenderedRoute, reviewRoute(3));
});

test('review turn CSS uses physical directional sheet motion and disables it for reduced motion', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  assert.match(css, /\.review-paper\s*\{[\s\S]*view-transition-name:\s*review-paper/);
  assert.match(css, /::view-transition-group\(review-paper\)[\s\S]*1250ms[\s\S]*cubic-bezier\(\.32,\s*\.02,\s*\.18,\s*1\)[\s\S]*perspective:\s*2200px/);
  assert.match(css, /review-turn-next-old[\s\S]*rotateY\(-180deg\)/);
  assert.match(css, /review-turn-previous-old[\s\S]*rotateY\(180deg\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.review-paper\s*\{\s*view-transition-name:\s*none/);
});

test('review rail has a wide fluid target with informative nearest-item feedback', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  assert.match(css, /\.review-rail\s*\{[\s\S]*width:\s*150px/);
  assert.match(css, /\.review-rail\s*\{[\s\S]*user-select:\s*none/);
  assert.match(css, /\.review-rail::after[\s\S]*var\(--review-rail-y/);
  assert.match(css, /\.review-rail-tick\.is-active[\s\S]*width:\s*52px/);
  assert.match(css, /\.review-rail-tick\.is-near[\s\S]*translateX\(3px\)/);
  assert.match(css, /\.review-rail-tick\.is-active \.review-rail-tip[\s\S]*opacity:\s*1/);
});

test('interactive map surfaces prevent selection while the circular cursor stays visible above fixed controls', async () => {
  const css = await readFile(new URL('style.css', projectRoot), 'utf8');
  assert.match(css, /\.archive-mindmap-viewport,[\s\S]*\.review-live-node[\s\S]*user-select:\s*none/);
  assert.match(css, /\.after-cursor\s*\{[\s\S]*z-index:\s*40/);
  assert.match(css, /\.after-cursor\s*\{[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.review-return-after\s*\{[\s\S]*z-index:\s*30/);
});
