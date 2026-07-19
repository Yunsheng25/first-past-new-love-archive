import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ARCHIVE_LAST_CASE_KEY,
  bindArchiveDetailInteractions,
  bindArchiveIndexInteractions,
  buildArchiveDetail,
  buildArchiveIndex,
  copyArchivePrompt,
  escapeArchiveHtml,
  filterArchiveCases,
  mountArchiveRoute,
  readArchiveLastCase,
  resolveArchiveCase,
  writeArchiveLastCase,
} from '../src/archive-ui.js';

const archive = JSON.parse(await readFile(new URL('../data/archive.json', import.meta.url), 'utf8'));
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');

function mappingSignature(data) {
  const mapping = data.cases.map((item) => ({
    id: item.id,
    index: item.index,
    nodeId: item.source.nodeId,
    x: item.source.position.x,
    y: item.source.position.y,
    images: item.images.map((image) => [image.occurrence, image.originalRef, image.src, image.role]),
  }));
  return createHash('sha256').update(JSON.stringify(mapping)).digest('hex');
}

test('real archive mapping keeps 72 visual-order cases and its locked mapping signature', () => {
  assert.equal(archive.cases.length, 72);
  assert.deepEqual(archive.cases.map((item) => item.id),
    Array.from({ length: 72 }, (_, index) => `case-${String(index + 1).padStart(2, '0')}`));
  for (let index = 1; index < archive.cases.length; index += 1) {
    const previous = archive.cases[index - 1];
    const current = archive.cases[index];
    const order = previous.source.position.y - current.source.position.y
      || previous.source.position.x - current.source.position.x
      || previous.source.nodeId.localeCompare(current.source.nodeId);
    assert.ok(order <= 0, `${previous.id} must remain before ${current.id}`);
  }
  assert.equal(mappingSignature(archive), 'fb8c02cd31ca9a851afb1f847cbd614fbf4cc5fcf237f15fd2aa01f9d3be71df');
});

test('real archive keeps every image occurrence, role and duplicated 18.png occurrence', () => {
  const occurrences = archive.cases.flatMap((item) => item.images.map((image, index) => ({
    caseId: item.id,
    index,
    ...image,
  })));
  assert.equal(occurrences.length, 138);
  assert.equal(new Set(occurrences.map((item) => item.src)).size, 137);
  assert.deepEqual(archive.summary.typeCounts, {
    '首尾帧': 44,
    '图生视频': 25,
    '转场': 1,
    '生图': 1,
    '剪辑参考': 1,
  });
  for (const item of occurrences) {
    assert.equal(item.occurrence, item.index + 1);
    assert.match(item.src, /^assets\/canvas-images\//);
    assert.ok(item.role.length > 0);
  }
  assert.deepEqual(
    occurrences.filter((item) => item.originalRef === '18.png').map((item) => [item.caseId, item.index, item.role, item.src]),
    [
      ['case-21', 1, '尾帧', 'assets/canvas-images/038-18.png'],
      ['case-22', 0, '首帧', 'assets/canvas-images/038-18.png'],
    ],
  );
});

test('every real detail renders its exact per-case image occurrence order without review media', () => {
  const actual = archive.cases.flatMap((item) => {
    const html = buildArchiveDetail(archive, item.id);
    assert.doesNotMatch(html, /review-media|assets\/review-media/);
    return [...html.matchAll(/data-archive-image-index="(\d+)" data-src="([^"]+)"[\s\S]*?<figcaption><span>([^<]+)<\/span><span>([^<]+)<\/span><small>出现 (\d+)<\/small>/g)]
      .map((match) => [item.id, Number(match[1]), match[2], match[3], match[4], Number(match[5])]);
  });
  const expected = archive.cases.flatMap((item) => item.images.map((image, index) => [
    item.id, index, image.src, image.role, image.originalRef, image.occurrence,
  ]));
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 138);
});

test('filtering and search only hide cases and never reorder them', () => {
  const typeOnly = filterArchiveCases(archive.cases, { types: ['图生视频'] });
  assert.equal(typeOnly.length, 25);
  assert.deepEqual(typeOnly.map((item) => item.id), archive.cases.filter((item) => item.type === '图生视频').map((item) => item.id));

  const combined = filterArchiveCases(archive.cases, {
    query: '老人',
    types: ['首尾帧', '图生视频'],
    stages: ['钢琴与回忆', '病房'],
  });
  assert.ok(combined.length > 0);
  assert.deepEqual(combined.map((item) => item.index), [...combined.map((item) => item.index)].sort((a, b) => a - b));
  assert.ok(combined.every((item) => ['首尾帧', '图生视频'].includes(item.type)));
  assert.ok(combined.every((item) => ['钢琴与回忆', '病房'].includes(item.stage)));
  assert.ok(combined.every((item) => [item.title, item.prompt, ...item.tags].join(' ').includes('老人')));

  const tagMatch = filterArchiveCases(archive.cases, { query: '剪辑参考' });
  assert.equal(tagMatch.length, 1);
  assert.equal(tagMatch[0].type, '剪辑参考');
});

test('typing a search term restores focus and caret after the filtered index rerenders', () => {
  const listeners = new Map();
  let renderCount = 0;
  const replacement = { focused: false, focus() { this.focused = true; }, setSelectionRange(start, end) { this.range = [start, end]; } };
  const root = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener() {},
    querySelector(selector) { return selector === '[data-archive-query]' ? replacement : null; },
  };
  const state = { query: '', types: [], stages: [] };
  bindArchiveIndexInteractions(root, archive, state, () => { renderCount += 1; });
  const input = {
    value: '老人', selectionStart: 2, selectionEnd: 2,
    matches(selector) { return selector === '[data-archive-query]'; },
  };
  listeners.get('input')({ target: input });
  assert.equal(state.query, '老人');
  assert.equal(renderCount, 1);
  assert.equal(replacement.focused, true);
  assert.deepEqual(replacement.range, [2, 2]);
});

test('IME composition defers filtering until compositionend and applies the final Chinese query once', () => {
  const listeners = new Map();
  let renderCount = 0;
  const replacement = { focused: false, focus() { this.focused = true; }, setSelectionRange(start, end) { this.range = [start, end]; } };
  const root = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    querySelector(selector) { return selector === '[data-archive-query]' ? replacement : null; },
  };
  const state = { query: '', types: [], stages: [] };
  const cleanup = bindArchiveIndexInteractions(root, archive, state, () => { renderCount += 1; });
  const input = {
    value: '老', selectionStart: 1, selectionEnd: 1,
    matches(selector) { return selector === '[data-archive-query]'; },
  };
  listeners.get('compositionstart')({ target: input });
  listeners.get('input')({ target: input, isComposing: true });
  input.value = '老人';
  input.selectionStart = 2;
  input.selectionEnd = 2;
  listeners.get('input')({ target: input, isComposing: true });
  listeners.get('input')({ target: input, isComposing: false });
  assert.equal(renderCount, 0);
  assert.equal(state.query, '');

  listeners.get('compositionend')({ target: input });
  assert.equal(renderCount, 1);
  assert.equal(state.query, '老人');
  assert.equal(replacement.focused, true);
  assert.deepEqual(replacement.range, [2, 2]);
  assert.deepEqual(
    filterArchiveCases(archive.cases, state).map((item) => item.id),
    archive.cases.filter((item) => [item.title, item.prompt, ...item.tags].join(' ').includes('老人')).map((item) => item.id),
  );

  cleanup();
  assert.equal(listeners.has('compositionstart'), false);
  assert.equal(listeners.has('compositionend'), false);
  assert.equal(listeners.has('input'), false);
});

test('index renders ordered lazy cards, controls, fixed returns and clean empty state', () => {
  const html = buildArchiveIndex(archive, { query: '', types: [], stages: [] }, 'case-21');
  const ids = [...html.matchAll(/data-archive-card="(case-\d{2})"/g)].map((match) => match[1]);
  assert.deepEqual(ids, archive.cases.map((item) => item.id));
  assert.match(html, /72 个案例/);
  assert.match(html, /137 张图片/);
  assert.match(html, /data-archive-query/);
  assert.match(html, /data-archive-type-filter="首尾帧"/);
  assert.match(html, /data-archive-type-all[^>]+aria-pressed="true"/);
  assert.equal((html.match(/data-archive-type-(?:all|filter=)/g) ?? []).length, 6);
  assert.match(html, /data-archive-stage-filter=/);
  assert.match(html, /data-continue-archive[^>]+href="#archive\/case-21"/);
  assert.match(html, /href="#after"[^>]+data-return-after/);
  assert.match(html, /loading="lazy" decoding="async"/);
  assert.doesNotMatch(html, /review-media/);

  const empty = buildArchiveIndex(archive, { query: '不存在的检索词', types: [], stages: [] });
  assert.match(empty, /data-archive-empty/);
  assert.match(empty, /data-clear-archive-filters/);
});

test('the independent all-types control only clears type selections and specific types make it inactive', () => {
  const listeners = new Map();
  const state = { query: '老人', types: ['首尾帧', '图生视频'], stages: ['病房'] };
  let renderCount = 0;
  const root = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener() {},
    querySelector() { return null; },
  };
  bindArchiveIndexInteractions(root, archive, state, () => { renderCount += 1; });
  const allButton = {
    closest(selector) { return selector === '[data-archive-type-all]' ? this : null; },
  };
  listeners.get('click')({ target: allButton });
  assert.deepEqual(state, { query: '老人', types: [], stages: ['病房'] });
  assert.equal(renderCount, 1);
  assert.match(buildArchiveIndex(archive, state), /data-archive-type-all[^>]+aria-pressed="true"/);

  const typeInput = {
    checked: true,
    getAttribute(name) { return name === 'data-archive-type-filter' ? '图生视频' : null; },
  };
  listeners.get('change')({ target: typeInput });
  assert.deepEqual(state.types, ['图生视频']);
  assert.equal(renderCount, 2);
  assert.match(buildArchiveIndex(archive, state), /data-archive-type-all[^>]+aria-pressed="false"/);
});

test('detail renders exact image occurrence sequence, clean prompt and adjacent JSON navigation', () => {
  const resolved = resolveArchiveCase(archive, 'case-21');
  assert.equal(resolved.previous?.id, 'case-20');
  assert.equal(resolved.next?.id, 'case-22');
  const html = buildArchiveDetail(archive, 'case-21');
  const rendered = [...html.matchAll(/data-archive-image-index="(\d+)"[\s\S]*?data-src="([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"/g)]
    .map((match) => [Number(match[1]), match[2], match[3]]);
  assert.deepEqual(rendered, archive.cases[20].images.map((image, index) => [index, image.src, image.src]));
  assert.match(html, /data-copy-prompt/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /!\[\[/);
  assert.match(html, /href="#archive\/case-20"[^>]+data-archive-prev/);
  assert.match(html, /href="#archive\/case-22"[^>]+data-archive-next/);
  assert.match(html, /href="#archive"[^>]+data-archive-all/);
  assert.match(html, /href="#after"[^>]+data-return-after/);
});

test('detail edge cases never invent images, prompts, or uncertainty explanations', () => {
  const synthetic = {
    summary: { cases: 1, uniqueImages: 0 },
    cases: [{
      id: 'case-01', index: 1, title: '<无图>', type: '生图', stage: '测试', tags: ['<tag>'],
      prompt: '', rawText: '![[do-not-render.png]]', uncertain: true,
      uncertainReasons: ['源节点 <不确定>'], images: [],
      source: { nodeId: 'node<1>', position: { x: 1, y: 2 }, groups: [] },
    }],
  };
  const html = buildArchiveDetail(synthetic, 'case-01');
  assert.match(html, /白板未附图片/);
  assert.match(html, /白板未提供提示词/);
  assert.match(html, /源节点 &lt;不确定&gt;/);
  assert.doesNotMatch(html, /do-not-render/);
  assert.doesNotMatch(html, /review-media|assets\/review-media/);
  assert.match(html, /&lt;无图&gt;/);
  assert.equal(escapeArchiveHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});

test('invalid detail id has a friendly route-safe error', () => {
  assert.equal(resolveArchiveCase(archive, 'case-00'), null);
  const html = buildArchiveDetail(archive, '<bad>');
  assert.match(html, /data-archive-missing/);
  assert.match(html, /没有找到这个案例/);
  assert.match(html, /href="#archive"/);
  assert.doesNotMatch(html, /<bad>/);
});

test('last case storage tolerates malformed or blocked storage', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(writeArchiveLastCase(storage, 'case-09'), true);
  assert.equal(values.get(ARCHIVE_LAST_CASE_KEY), 'case-09');
  assert.equal(readArchiveLastCase(storage, archive), 'case-09');
  values.set(ARCHIVE_LAST_CASE_KEY, 'case-99');
  assert.equal(readArchiveLastCase(storage, archive), null);
  assert.equal(readArchiveLastCase({ getItem() { throw new Error('blocked'); } }, archive), null);
  assert.equal(writeArchiveLastCase({ setItem() { throw new Error('blocked'); } }, 'case-01'), false);
});

test('copy uses Clipboard API, then textarea fallback, and reports final failure without throwing', async () => {
  let copied = '';
  assert.equal(await copyArchivePrompt('clean prompt', {
    navigatorRef: { clipboard: { writeText: async (text) => { copied = text; } } },
    documentRef: {},
  }), true);
  assert.equal(copied, 'clean prompt');

  const textarea = { value: '', style: {}, selectCalled: false, select() { this.selectCalled = true; }, remove() {} };
  const documentRef = {
    body: { append() {} },
    createElement: () => textarea,
    execCommand: (command) => command === 'copy',
  };
  assert.equal(await copyArchivePrompt('fallback prompt', {
    navigatorRef: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
    documentRef,
  }), true);
  assert.equal(textarea.value, 'fallback prompt');
  assert.equal(textarea.selectCalled, true);
  assert.equal(await copyArchivePrompt('failure', { navigatorRef: {}, documentRef: {} }), false);
});

test('successful textarea copy fallback restores the original selection, focus, and removes its textarea', async () => {
  const originalActive = {
    isConnected: true,
    focused: false,
    focus() { this.focused = true; },
  };
  const originals = [
    { name: 'one', cloneRange() { return { name: 'one-clone' }; } },
    { name: 'two', cloneRange() { return { name: 'two-clone' }; } },
  ];
  const restored = [];
  const selection = {
    rangeCount: originals.length,
    getRangeAt(index) { return originals[index]; },
    removeAllRanges() { restored.length = 0; },
    addRange(range) { restored.push(range); },
  };
  const textarea = {
    style: {}, removed: false, selected: false,
    setAttribute() {},
    select() { this.selected = true; },
    remove() { this.removed = true; },
  };
  const documentRef = {
    activeElement: originalActive,
    getSelection: () => selection,
    body: { append(node) { assert.equal(node, textarea); } },
    createElement: (tag) => { assert.equal(tag, 'textarea'); return textarea; },
    execCommand: (command) => { assert.equal(command, 'copy'); return true; },
  };
  const result = await copyArchivePrompt('fallback prompt', { navigatorRef: {}, documentRef });
  assert.equal(result, true);
  assert.equal(textarea.selected, true);
  assert.equal(textarea.removed, true);
  assert.deepEqual(restored, [{ name: 'one-clone' }, { name: 'two-clone' }]);
  assert.equal(originalActive.focused, true);
});

test('real copy click keeps its button focus through successful textarea fallback and resets aria busy state', async () => {
  const listeners = new Map();
  const status = { textContent: '' };
  const classes = new Set();
  const copyButton = {
    attributes: new Map(),
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    closest(selector) { return selector === '[data-copy-prompt]' ? this : null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    focus() { documentRef.activeElement = this; },
  };
  const selection = { rangeCount: 0, removeAllRanges() {}, addRange() {} };
  const textarea = {
    style: {}, removed: false, setAttribute() {},
    select() { documentRef.activeElement = this; },
    remove() { this.removed = true; },
  };
  const documentRef = {
    activeElement: copyButton,
    getSelection: () => selection,
    createElement: () => textarea,
    body: { append() {} },
    execCommand: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const root = {
    querySelector: (selector) => selector === '[data-copy-status]' ? status : null,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener() {},
  };
  bindArchiveDetailInteractions(root, { prompt: 'clean', documentRef, navigatorRef: {} });
  await listeners.get('click')({ target: copyButton });
  assert.equal(documentRef.activeElement, copyButton);
  assert.equal(copyButton.getAttribute('aria-disabled'), 'false');
  assert.equal(classes.has('is-copying'), false);
  assert.equal(textarea.removed, true);
  assert.equal(status.textContent, '提示词已复制');
  assert.equal('disabled' in copyButton && copyButton.disabled, false);
});

test('real copy click ignores rapid reentry while keeping a focusable aria busy button', async () => {
  const listeners = new Map();
  let resolveCopy;
  let calls = 0;
  const pending = new Promise((resolve) => { resolveCopy = resolve; });
  const attributes = new Map();
  const classes = new Set();
  const copyButton = {
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    closest: (selector) => selector === '[data-copy-prompt]' ? copyButton : null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
  const status = { textContent: '' };
  const root = {
    querySelector: (selector) => selector === '[data-copy-status]' ? status : null,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener() {},
  };
  const documentRef = { addEventListener() {}, removeEventListener() {} };
  bindArchiveDetailInteractions(root, {
    prompt: 'clean', documentRef,
    copyPrompt: async () => { calls += 1; return pending; },
  });
  const first = listeners.get('click')({ target: copyButton });
  const second = listeners.get('click')({ target: copyButton });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(attributes.get('aria-disabled'), 'true');
  assert.equal(classes.has('is-copying'), true);
  assert.equal(status.textContent, '正在复制…');
  assert.equal('disabled' in copyButton, false);
  resolveCopy(true);
  await Promise.all([first, second]);
  assert.equal(attributes.get('aria-disabled'), 'false');
  assert.equal(classes.has('is-copying'), false);
});

test('final copy failure selects the visible clean prompt and announces manual copy accessibly', async () => {
  const listeners = new Map();
  const status = { textContent: '' };
  const visiblePrompt = { focused: false, focus() { this.focused = true; documentRef.activeElement = this; } };
  const copyButton = {
    attributes: new Map(),
    closest(selector) { return selector === '[data-copy-prompt]' ? this : null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  };
  const range = {
    target: null,
    selectNodeContents(target) { this.target = target; },
  };
  const selection = {
    removed: false,
    added: null,
    removeAllRanges() { this.removed = true; },
    addRange(nextRange) { this.added = nextRange; },
  };
  const root = {
    querySelector(selector) {
      return {
        '[data-archive-lightbox]': null,
        '[data-copy-status]': status,
        '[data-archive-prompt]': visiblePrompt,
      }[selector] ?? null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, handler) { listeners.set(`root:${type}`, handler); },
    removeEventListener() {},
  };
  const documentRef = {
    activeElement: null,
    createRange: () => range,
    getSelection: () => selection,
    addEventListener(type, handler) { listeners.set(`doc:${type}`, handler); },
    removeEventListener() {},
  };
  bindArchiveDetailInteractions(root, {
    prompt: '完整 clean prompt',
    documentRef,
    copyPrompt: async () => false,
  });
  await listeners.get('root:click')({ target: copyButton });
  assert.equal(range.target, visiblePrompt);
  assert.equal(selection.removed, true);
  assert.equal(selection.added, range);
  assert.equal(visiblePrompt.focused, true);
  assert.equal(documentRef.activeElement, visiblePrompt);
  assert.equal(status.textContent, '复制失败，已选中提示词，请手动复制');
  assert.equal(copyButton.getAttribute('aria-disabled'), 'false');
  assert.equal('disabled' in copyButton, false);
});

test('selection API failure after copy failure never throws and still reports a manual action', async () => {
  const listeners = new Map();
  const status = { textContent: '' };
  const copyButton = { disabled: false, closest: (selector) => selector === '[data-copy-prompt]' ? copyButton : null };
  const root = {
    querySelector: (selector) => selector === '[data-copy-status]' ? status : selector === '[data-archive-prompt]' ? {} : null,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener() {},
  };
  const documentRef = {
    createRange() { throw new Error('selection blocked'); },
    addEventListener() {}, removeEventListener() {},
  };
  bindArchiveDetailInteractions(root, { prompt: 'clean', documentRef, copyPrompt: async () => false });
  await assert.doesNotReject(() => listeners.get('click')({ target: copyButton }));
  assert.equal(status.textContent, '复制失败，请手动选择提示词');
});

function eventTarget(attributes = {}) {
  return {
    hidden: false,
    attributes: new Map(Object.entries(attributes)),
    focused: false,
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    focus() { this.focused = true; },
    closest(selector) { return this.matches?.(selector) ? this : null; },
  };
}

test('detail lightbox stays inside one case, supports arrows/Escape, traps and restores focus', () => {
  const listeners = new Map();
  const triggers = [0, 1, 2].map((index) => {
    const target = eventTarget({ 'data-archive-image-index': String(index) });
    target.matches = (selector) => selector === '[data-archive-lightbox-trigger]';
    return target;
  });
  const image = eventTarget();
  const close = eventTarget();
  close.matches = (selector) => selector === '[data-close-archive-lightbox]';
  const previous = eventTarget();
  const next = eventTarget();
  const lightbox = eventTarget();
  lightbox.querySelector = (selector) => ({ img: image, '[data-close-archive-lightbox]': close,
    '[data-archive-lightbox-prev]': previous, '[data-archive-lightbox-next]': next }[selector]);
  lightbox.querySelectorAll = () => [close, previous, next];
  const root = {
    querySelector: (selector) => selector === '[data-archive-lightbox]' ? lightbox : null,
    querySelectorAll: (selector) => selector === '[data-archive-lightbox-trigger]' ? triggers : [],
    addEventListener(type, fn) { listeners.set(`root:${type}`, fn); },
    removeEventListener() {},
  };
  const documentRef = {
    activeElement: triggers[0],
    addEventListener(type, fn) { listeners.set(`doc:${type}`, fn); },
    removeEventListener() {},
  };
  const images = [
    { src: 'assets/canvas-images/a.png', alt: 'a' },
    { src: 'assets/canvas-images/b.png', alt: 'b' },
    { src: 'assets/canvas-images/b.png', alt: 'b duplicate occurrence' },
  ];
  const cleanup = bindArchiveDetailInteractions(root, { images, documentRef, copyPrompt: async () => true });
  listeners.get('root:click')({ target: triggers[1] });
  assert.equal(lightbox.hidden, false);
  assert.equal(image.getAttribute('src'), images[1].src);
  listeners.get('doc:keydown')({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(image.getAttribute('src'), images[2].src);
  listeners.get('doc:keydown')({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(image.getAttribute('src'), images[2].src, 'must not leave this case');
  listeners.get('doc:keydown')({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(image.getAttribute('src'), images[1].src);
  listeners.get('doc:keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(lightbox.hidden, true);
  assert.equal(triggers[1].focused, true);
  cleanup();
});

test('mount has loading/error/retry and stale completion guard with route cleanup', async () => {
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const app = { innerHTML: '', focus() {}, querySelector() { return null; }, addEventListener() {}, removeEventListener() {} };
  const cleanup = mountArchiveRoute(app, { name: 'archive-index' }, {
    fetchImpl: () => pending,
    storage: null,
    documentRef: { addEventListener() {}, removeEventListener() {} },
    windowRef: {},
  });
  assert.match(app.innerHTML, /data-archive-loading/);
  cleanup();
  resolveFetch({ ok: true, json: async () => archive });
  await Promise.resolve();
  await Promise.resolve();
  assert.match(app.innerHTML, /data-archive-loading/);

  let retryHandler;
  const retry = { addEventListener(type, handler) { retryHandler = handler; }, removeEventListener() {} };
  const errorApp = { innerHTML: '', focus() {}, querySelector(selector) { return selector === '[data-retry-archive]' ? retry : null; } };
  mountArchiveRoute(errorApp, { name: 'archive-index' }, {
    fetchImpl: async () => ({ ok: false, status: 500 }), storage: null,
    documentRef: {}, windowRef: {},
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.match(errorApp.innerHTML, /data-archive-error/);
  assert.equal(typeof retryHandler, 'function');
});

test('real script mounts archive routes and CSS constrains each route to internal scrolling', () => {
  assert.match(script, /mountArchiveRoute/);
  assert.match(script, /route\.name === 'archive-index' \|\| route\.name === 'archive-detail'/);
  assert.match(css, /\.archive-index-view[\s\S]*height:\s*100dvh/);
  assert.match(css, /\.archive-detail-view[\s\S]*height:\s*100dvh/);
  assert.match(css, /\.archive-grid-scroll[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.archive-detail-scroll[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.archive-detail-layout[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
