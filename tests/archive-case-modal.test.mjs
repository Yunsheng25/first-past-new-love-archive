import test from 'node:test';
import assert from 'node:assert/strict';

import archive from '../data/archive.json' with { type: 'json' };
import { flattenArchiveOccurrences } from '../src/archive-tunnel-data.js';
import {
  resolveCaseFromOccurrence,
  caseNeighbor,
  buildArchiveCaseModal,
  mountArchiveCaseModal,
} from '../src/archive-case-modal.js';

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
    assert.match(html, new RegExp(item.prompt.slice(0, 24)));
  }

  const one = archive.cases.find((item) => item.images.length === 1);
  const nine = archive.cases.find((item) => item.images.length === 9);
  assert.equal((buildArchiveCaseModal(one, occurrenceFor(one)).match(/data-case-image-role=/g) ?? []).length, 1);
  const nineHtml = buildArchiveCaseModal(nine, occurrenceFor(nine));
  assert.match(nineHtml, /data-case-gallery="many"/);
  assert.equal((nineHtml.match(/data-case-image-role=/g) ?? []).length, 9);
  assert.deepEqual([...nineHtml.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]), nine.images.map((image) => image.src));
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
  listeners.get('host:click')({ target: host });
  assert.equal(closes, 1);
  controller.close();
  assert.equal(closes, 1);
  assert.equal(trigger.focused, 1);
  assert.equal(listeners.has('doc:keydown'), false);
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
