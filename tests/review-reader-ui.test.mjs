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
  readReviewProgress,
  renderInlineMarkdown,
  writeReviewProgress,
} from '../src/review-reader.js';

const projectRoot = new URL('../', import.meta.url);
const reviewData = JSON.parse(await readFile(new URL('data/review.json', projectRoot), 'utf8'));

function expectedSignature(chapter, pageIndex) {
  return chapter.pages[pageIndex].map((block, blockIndex) => ({
    type: block.type,
    blockIndex,
    src: block.src ?? '',
  }));
}

function renderedSignature(html) {
  return [...html.matchAll(/<[^>]+data-block-type="([^"]+)"[^>]+data-block-index="(\d+)"[^>]*>/g)]
    .map((match) => ({
      type: match[1],
      blockIndex: Number(match[2]),
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

test('review index renders all five chapters and 27 pages in source JSON order', () => {
  const html = buildReviewIndex(reviewData, null);
  const renderedTitles = [...html.matchAll(/data-review-chapter-title>([^<]+)</g)].map((match) => match[1]);

  assert.equal(reviewData.chapters.length, 5);
  assert.equal(reviewData.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0), 27);
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
  const expected = reviewData.chapters.map((chapter) => {
    const chineseCharacters = chapter.pages.flat()
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

test('chapter previews use only their own first image and text placeholders otherwise', () => {
  const html = buildReviewIndex(reviewData, null);
  const ownFirstImages = new Map(reviewData.chapters.map((chapter) => [
    chapter.slug,
    chapter.pages.flat().find((block) => block.type === 'image')?.src ?? null,
  ]));
  const previewImages = [...html.matchAll(/<img\b[^>]*data-chapter-preview="([^"]+)"[^>]*src="([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);
  const placeholders = [...html.matchAll(/data-chapter-placeholder="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(previewImages, [
    ['story', ownFirstImages.get('story')],
    ['production', ownFirstImages.get('production')],
  ]);
  assert.deepEqual(placeholders, ['origin', 'reflection', 'closing']);
  assert.equal(previewImages.every(([slug, src]) => src === ownFirstImages.get(slug)), true);
  assert.doesNotMatch(html, /data-chapter-preview[^>]*data-occurrence|data-chapter-preview[^>]*data-block-type/);
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
      expectedCount += page.length;
    });
  }

  assert.equal(expectedCount, 394);
  assert.equal(renderedCount, 394);
});

test('all 51 media occurrences render in place and both duplicate occurrences remain', () => {
  const expectedMedia = reviewData.chapters.flatMap((chapter) => chapter.pages.flat())
    .filter((block) => block.type === 'image' || block.type === 'video')
    .map((block) => `${block.type}:${block.src}`);
  const renderedMedia = [];

  for (const chapter of reviewData.chapters) {
    chapter.pages.forEach((page, pageIndex) => {
      const html = buildReviewPage(reviewData, { chapter, pageIndex });
      for (const match of html.matchAll(/data-block-type="(image|video)"[^>]+data-block-index="\d+"[^>]+data-source="([^"]+)"/g)) {
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

  assert.deepEqual(
    [storyStart.overallPage, productionMiddle.overallPage, reflectionStart.overallPage],
    [4, 13, 20],
  );
  assert.equal(productionMiddle.totalPages, 27);
  const html = buildReviewPage(reviewData, productionMiddle);
  assert.match(html, /全篇\s*13\s*\/\s*27/);
  assert.match(html, /本章\s*7\s*\/\s*13/);
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
  const pageIndex = chapter.pages.findIndex((page) => page.some((block) => block.text?.startsWith('[!NOTE]')));
  const html = buildReviewPage(reviewData, { chapter, pageIndex });

  assert.match(html, /class="[^"]*\breview-note\b[^"]*"/);
  assert.match(html, />注<\/span>/);
  assert.doesNotMatch(html, /\[!NOTE\]/);
  assert.doesNotMatch(html, /NaN/);
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
  assert.match(css, /\.review-index-placeholder/);
  assert.match(css, /\.review-index-main[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(css, /\.review-index-list[\s\S]*min-height:\s*0[\s\S]*max-height:/);
  assert.match(css, /\.review-chapter-drawer[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(css, /@media\s*\(max-height:\s*650px\)[\s\S]*\.review-index-list/);
});

test('script routes both review destinations through cancellable review mounting', async () => {
  const script = await readFile(new URL('script.js', projectRoot), 'utf8');

  assert.match(script, /mountReviewRoute/);
  assert.match(script, /route\.name === 'review-index'/);
  assert.match(script, /route\.name === 'review-page'/);
  assert.match(script, /currentViewCleanup\s*=\s*mountReviewRoute/);
  assert.match(script, /currentViewCleanup\(\)/);
});
