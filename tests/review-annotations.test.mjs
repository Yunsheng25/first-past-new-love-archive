import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REVIEW_READER_STATE_KEY,
  createTextQuoteAnchor,
  readReaderState,
  removeAnnotation,
  upsertAnnotation,
  writeReaderState,
} from '../src/review-annotations.js';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test('reader state persists theme, font, progress and exact text annotations', () => {
  const storage = fakeStorage();
  const state = upsertAnnotation(readReaderState(storage), {
    id: 'origin-1-12-20',
    chapter: 'origin',
    page: 1,
    quote: '作品真正抵达人心',
    prefix: '迷恋',
    suffix: '的瞬间',
    kind: 'note',
    note: '核心创作动机',
  });
  state.theme = 'dark';
  state.fontSize = 20;
  state.progress = { chapter: 'production', page: 7 };

  writeReaderState(storage, state);
  const restored = readReaderState(storage);

  assert.equal(restored.theme, 'dark');
  assert.equal(restored.fontSize, 20);
  assert.deepEqual(restored.progress, { chapter: 'production', page: 7 });
  assert.equal(restored.annotations[0].quote, '作品真正抵达人心');
  assert.equal(restored.annotations[0].note, '核心创作动机');
});

test('malformed storage falls back to stable reader defaults', () => {
  const state = readReaderState(fakeStorage({ [REVIEW_READER_STATE_KEY]: '{broken' }));

  assert.equal(state.theme, 'light');
  assert.equal(state.fontSize, 18);
  assert.equal(state.progress, null);
  assert.deepEqual(state.annotations, []);
});

test('upsert replaces the same annotation without changing unrelated annotations', () => {
  const first = { id: 'a', quote: '第一句', kind: 'highlight' };
  const second = { id: 'b', quote: '第二句', kind: 'note', note: '旧批注' };
  const state = upsertAnnotation(upsertAnnotation(readReaderState(), first), second);
  const changed = upsertAnnotation(state, { ...second, note: '新批注' });

  assert.deepEqual(changed.annotations.map((item) => item.id), ['a', 'b']);
  assert.equal(changed.annotations[1].note, '新批注');
  assert.deepEqual(removeAnnotation(changed, 'a').annotations, [{ ...second, note: '新批注' }]);
});

test('text quote anchors retain nearby context for repeated sentences', () => {
  const text = '前文很长。作品真正抵达人心的瞬间。后文继续。';
  const anchor = createTextQuoteAnchor(text, 5, 16, { contextLength: 5 });

  assert.equal(anchor.quote, text.slice(5, 16));
  assert.equal(anchor.prefix, text.slice(0, 5));
  assert.equal(anchor.suffix, text.slice(16, 21));
});

test('writeReaderState tolerates unavailable storage', () => {
  assert.doesNotThrow(() => writeReaderState(null, readReaderState(null)));
  assert.doesNotThrow(() => writeReaderState({ setItem() { throw new Error('denied'); } }, readReaderState(null)));
});
