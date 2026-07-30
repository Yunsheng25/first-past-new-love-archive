import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import archive from '../data/archive.json' with { type: 'json' };
import { flattenArchiveOccurrences } from '../src/archive-tunnel-data.js';
import {
  resolveCaseFromOccurrence,
  caseNeighbor,
  buildArchiveCaseModal,
  mountArchiveCaseModal,
} from '../src/archive-case-modal.js';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

const occurrenceFor = (caseItem, imageIndex = 0) => ({
  caseId: caseItem.id,
  caseIndex: caseItem.index - 1,
  imageIndex,
  src: caseItem.images[imageIndex].src,
  role: caseItem.images[imageIndex].role,
});

test('resolves only an exact authored occurrence and navigates authored case order', () => {
  const target = archive.cases[20];
  assert.equal(resolveCaseFromOccurrence(archive, occurrenceFor(target, 1)), target);
  assert.equal(resolveCaseFromOccurrence(archive, { ...occurrenceFor(target), imageIndex: '1' }), null);
  assert.equal(resolveCaseFromOccurrence(archive, { ...occurrenceFor(target), imageIndex: 99 }), null);
  assert.equal(resolveCaseFromOccurrence(archive, { ...occurrenceFor(target), src: 'wrong' }), null);
  assert.equal(resolveCaseFromOccurrence(archive, { caseId: 'case-99' }), null);
  assert.equal(caseNeighbor(archive, 'case-01', -1), null);
  assert.equal(caseNeighbor(archive, 'case-01', 1)?.id, 'case-02');
  assert.equal(caseNeighbor(archive, 'case-72', 1), null);
  assert.equal(caseNeighbor(archive, 'case-05', 2)?.id, 'case-07');
  assert.equal(caseNeighbor(archive, 'bad', 1), null);
});

test('renders exact actual gallery groups and complete selected case information', () => {
  const histogram = archive.cases.reduce((result, item) => {
    result[item.images.length] = (result[item.images.length] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(histogram, { 1: 13, 2: 58, 9: 1 });

  for (const item of archive.cases.filter((candidate) => candidate.images.length === 2)) {
    const html = buildArchiveCaseModal(item, occurrenceFor(item, 1), { totalCases: archive.cases.length });
    const roles = [...html.matchAll(/data-case-image-role="([^"]+)"[\s\S]*?<img src="([^"]+)"/g)]
      .map((match) => [match[1], match[2]]);
    assert.match(html, /data-case-gallery="two"/);
    assert.deepEqual(roles, item.images.map((image) => [image.role, image.src]), item.id);
    assert.ok(html.includes(item.prompt), `${item.id} keeps its complete prompt`);
  }

  const one = archive.cases.find((item) => item.images.length === 1);
  const nine = archive.cases.find((item) => item.images.length === 9);
  const oneHtml = buildArchiveCaseModal(one, occurrenceFor(one));
  assert.match(oneHtml, /data-case-gallery="one"/);
  assert.match(oneHtml, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.match(oneHtml, /data-case-modal-backdrop/);
  assert.match(oneHtml, /<p class="archive-case-prompt"/);
  assert.equal((oneHtml.match(/data-case-image-role=/g) ?? []).length, 1);
  const nineHtml = buildArchiveCaseModal(nine, occurrenceFor(nine));
  assert.match(nineHtml, /data-case-gallery="many"/);
  assert.equal((nineHtml.match(/data-case-image-role=/g) ?? []).length, 9);
  assert.deepEqual([...nineHtml.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]), nine.images.map((image) => image.src));
});

test('modal composition keeps the tunnel visible while full-opacity first and last frames stack vertically', () => {
  assert.match(css, /\.archive-case-modal-backdrop\s*\{[\s\S]*?background:\s*rgba\(2,\s*1,\s*5,\s*\.06\)[\s\S]*?backdrop-filter:\s*none/);
  assert.match(css, /\.archive-case-modal\s*\{[\s\S]*?background:\s*rgba\(18,\s*16,\s*21,\s*\.44\)[\s\S]*?backdrop-filter:\s*blur\(10px\)/);
  assert.match(css, /\.archive-case-modal \.archive-case-gallery\[data-case-gallery="two"\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*?grid-template-rows:\s*auto auto/);
  assert.match(css, /\.archive-case-image img\s*\{[\s\S]*?opacity:\s*1[\s\S]*?filter:\s*none/);
});

test('mobile modal removes fixed non-modal controls from the prompt reading area', () => {
  const mobileStart = css.indexOf('@media (max-width: 760px)', css.indexOf('.archive-tunnel-view'));
  const mobileCss = css.slice(mobileStart);
  assert.match(mobileCss, /body:has\(\[data-case-modal\]\)\s*>\s*\.bgm-toggle\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(mobileCss, /\.archive-tunnel-view:has\(\[data-case-modal\]\)\s*>\s*\.archive-return-after\s*\{[^}]*display:\s*none\s*!important/s);
});

test('escapes every modal interpolation without truncating line-broken prompts', () => {
  const item = { id: 'case-<x>', index: 1, title: '<title>', prompt: 'one\ntwo <script>', images: [{ src: 'x" onerror="1', role: '<role>' }] };
  const html = buildArchiveCaseModal(item, { caseId: item.id, imageIndex: 0, src: item.images[0].src, role: item.images[0].role });
  assert.match(html, /&lt;title&gt;/);
  assert.match(html, /one<br>two &lt;script&gt;/);
  assert.match(html, /x&quot; onerror=&quot;1/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /opacity:|filter:/);
  assert.doesNotMatch(html, /Demo|preview-end/i);
});

test('modal opens original media instead of the lightweight tunnel derivative', () => {
  const item = {
    id: 'case-01',
    index: 1,
    title: 'detail quality',
    prompt: 'prompt',
    images: [{
      src: 'assets/original.png',
      originalSrc: 'assets/original.png',
      displaySrc: 'assets/display.webp',
      role: '图片',
    }],
  };
  const html = buildArchiveCaseModal(item, {
    caseId: item.id,
    imageIndex: 0,
    src: item.images[0].src,
    role: item.images[0].role,
  });
  assert.match(html, /src="assets\/original\.png"/);
  assert.doesNotMatch(html, /src="assets\/display\.webp"/);
});

test('error modal states the escaped failure reason while normal modal has no error UI', () => {
  const error = { ...archive.cases[0], status: 'error', errorGroup: '出现人脸 <script>', errorReason: '人物失真 & 偏离' };
  const errorHtml = buildArchiveCaseModal(error, occurrenceFor(error));
  assert.match(errorHtml, /data-case-error-state/);
  assert.match(errorHtml, /错误尝试/);
  assert.match(errorHtml, /人物失真 &amp; 偏离/);
  assert.match(errorHtml, /出现人脸 &lt;script&gt;/);
  assert.doesNotMatch(errorHtml, /<script>/);
  assert.equal((errorHtml.match(/<img /g) ?? []).length, error.images.length);
  assert.ok(errorHtml.includes(error.prompt));

  const normal = { ...archive.cases[3], status: 'normal', errorGroup: null };
  assert.doesNotMatch(buildArchiveCaseModal(normal, occurrenceFor(normal)), /错误尝试|data-case-error-state/);
});

test('flattened role occurrences select their full shared authored case', () => {
  for (const occurrence of flattenArchiveOccurrences(archive)) {
    const item = resolveCaseFromOccurrence(archive, occurrence);
    assert.equal(item?.id, occurrence.caseId);
  }
});

function fakeElement(selector) {
  return {
    selector, disabled: false, textContent: '', focused: 0, attributes: new Map(),
    focus() { this.focused += 1; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    contains(target) { return target === this; },
  };
}

function modalHarness() {
  const listeners = new Map();
  const nodes = new Map();
  for (const selector of ['[data-case-modal]', '[data-case-modal-close]', '[data-case-modal-previous]', '[data-case-modal-next]', '[data-case-modal-copy]', '[data-case-modal-copy-status]']) nodes.set(selector, fakeElement(selector));
  nodes.get('[data-case-modal]').querySelectorAll = () => [nodes.get('[data-case-modal-close]'), nodes.get('[data-case-modal-previous]'), nodes.get('[data-case-modal-next]'), nodes.get('[data-case-modal-copy]')].filter((node) => !node.disabled);
  const host = {
    innerHTML: '',
    querySelector(selector) { return nodes.get(selector) ?? null; },
    querySelectorAll(selector) { return selector.includes('button') ? [nodes.get('[data-case-modal-close]'), nodes.get('[data-case-modal-previous]'), nodes.get('[data-case-modal-next]'), nodes.get('[data-case-modal-copy]')].filter((node) => !node.disabled) : []; },
    addEventListener(type, handler) { listeners.set(`host:${type}`, handler); },
    removeEventListener(type) { listeners.delete(`host:${type}`); },
  };
  const documentRef = { addEventListener(type, handler) { listeners.set(`doc:${type}`, handler); }, removeEventListener(type) { listeners.delete(`doc:${type}`); } };
  return { host, nodes, listeners, documentRef };
}

test('mounts, traps focus, navigates without closing, and closes idempotently', async () => {
  const { host, nodes, listeners, documentRef } = modalHarness();
  const trigger = fakeElement('trigger');
  let closes = 0;
  const controller = mountArchiveCaseModal(host, { data: archive, occurrence: occurrenceFor(archive.cases[0]), trigger, documentRef, onClose() { closes += 1; } });
  assert.ok(controller);
  assert.match(host.innerHTML, /data-case-modal/);
  assert.equal(nodes.get('[data-case-modal-close]').focused, 1);
  listeners.get('doc:keydown')({ key: 'Tab', preventDefault() {} });
  assert.equal(nodes.get('[data-case-modal-close]').focused, 2);
  listeners.get('host:click')({ target: nodes.get('[data-case-modal-next]'), preventDefault() {} });
  assert.match(host.innerHTML, /case-02/);
  assert.equal(closes, 0);
  listeners.get('host:click')({ target: fakeElement('card') });
  assert.equal(closes, 0);
  const backdrop = fakeElement('[data-case-modal-backdrop]');
  listeners.get('host:click')({ target: backdrop });
  assert.equal(closes, 1);
  controller.close();
  assert.equal(closes, 1);
  assert.equal(controller.navigate(1), false);
  assert.equal(trigger.focused, 1);
  assert.equal(listeners.has('doc:keydown'), false);
});

test('Escape closes safely even when consumer cleanup and trigger focus throw', () => {
  const { host, listeners, documentRef } = modalHarness();
  const trigger = { isConnected: true, focus() { throw new Error('detached'); } };
  const controller = mountArchiveCaseModal(host, { data: archive, occurrence: occurrenceFor(archive.cases[0]), trigger, documentRef, onClose() { throw new Error('consumer'); } });
  assert.doesNotThrow(() => listeners.get('doc:keydown')({ key: 'Escape', preventDefault() {} }));
  assert.equal(controller.close(), false);
});

test('mount handles invalid selection and contained clipboard completion after close', async () => {
  const { host, nodes, listeners, documentRef } = modalHarness();
  let closes = 0;
  assert.equal(mountArchiveCaseModal(host, { data: archive, occurrence: { caseId: 'bad' }, documentRef, onClose() { closes += 1; } }), null);
  assert.equal(closes, 1);
  let settle;
  const pending = new Promise((resolve) => { settle = resolve; });
  const controller = mountArchiveCaseModal(host, { data: archive, occurrence: occurrenceFor(archive.cases[1]), documentRef, navigatorRef: { clipboard: { writeText: () => pending } } });
  const click = listeners.get('host:click')({ target: nodes.get('[data-case-modal-copy]'), preventDefault() {} });
  controller.close();
  settle();
  await click;
  assert.equal(nodes.get('[data-case-modal-copy-status]').textContent, '');
});

test('a clipboard rejection that arrives after close never begins textarea fallback', async () => {
  const { host, nodes, listeners, documentRef } = modalHarness();
  let rejectClipboard;
  const pending = new Promise((_, reject) => { rejectClipboard = reject; });
  let created = 0;
  let appended = 0;
  let selected = 0;
  let executed = 0;
  let removed = 0;
  Object.assign(documentRef, {
    createElement() { created += 1; return { style: {}, select() { selected += 1; }, remove() { removed += 1; } }; },
    body: { append() { appended += 1; } },
    execCommand() { executed += 1; return true; },
  });
  const controller = mountArchiveCaseModal(host, { data: archive, occurrence: occurrenceFor(archive.cases[1]), documentRef, navigatorRef: { clipboard: { writeText: () => pending } } });
  listeners.get('host:click')({ target: nodes.get('[data-case-modal-copy]'), preventDefault() {} });
  controller.close();
  rejectClipboard(new Error('denied'));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual({ created, appended, selected, executed, removed }, { created: 0, appended: 0, selected: 0, executed: 0, removed: 0 });
});

test('navigation invalidates an older pending copy before its rejected fallback can mutate the new case', async () => {
  const { host, nodes, listeners, documentRef } = modalHarness();
  let rejectClipboard;
  const pending = new Promise((_, reject) => { rejectClipboard = reject; });
  let created = 0;
  let appended = 0;
  let selected = 0;
  let executed = 0;
  let removed = 0;
  Object.assign(documentRef, {
    createElement() { created += 1; return { style: {}, select() { selected += 1; }, remove() { removed += 1; } }; },
    body: { append() { appended += 1; } }, execCommand() { executed += 1; return true; },
  });
  const controller = mountArchiveCaseModal(host, { data: archive, occurrence: occurrenceFor(archive.cases[1]), documentRef, navigatorRef: { clipboard: { writeText: () => pending } } });
  listeners.get('host:click')({ target: nodes.get('[data-case-modal-copy]'), preventDefault() {} });
  controller.navigate(1);
  rejectClipboard(new Error('denied'));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual({ created, appended, selected, executed, removed }, { created: 0, appended: 0, selected: 0, executed: 0, removed: 0 });
  assert.equal(nodes.get('[data-case-modal-copy-status]').textContent, '');
  assert.equal(controller.caseItem.id, 'case-03');
});

test('textarea fallback restores focus and selection after success, failure, and exception', async () => {
  for (const outcome of [true, false, 'throw']) {
    const { host, nodes, listeners, documentRef } = modalHarness();
    const original = fakeElement('original');
    original.isConnected = true;
    const ranges = [{ cloneRange() { return { restored: 1 }; } }];
    const restored = [];
    const selection = { rangeCount: 1, getRangeAt() { return ranges[0]; }, removeAllRanges() { restored.length = 0; }, addRange(range) { restored.push(range); } };
    let removed = 0;
    Object.assign(documentRef, {
      activeElement: original,
      getSelection() { return selection; },
      createElement() { return { style: {}, setAttribute() {}, select() { documentRef.activeElement = this; }, remove() { removed += 1; } }; },
      body: { append() {} },
      execCommand() { if (outcome === 'throw') throw new Error('blocked'); return outcome; },
    });
    mountArchiveCaseModal(host, { data: archive, occurrence: occurrenceFor(archive.cases[1]), documentRef, navigatorRef: {} });
    listeners.get('host:click')({ target: nodes.get('[data-case-modal-copy]'), preventDefault() {} });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(removed, 1, String(outcome));
    assert.equal(original.focused, 1, String(outcome));
    assert.deepEqual(restored, [{ restored: 1 }], String(outcome));
  }
});
