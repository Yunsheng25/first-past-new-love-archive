import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReviewCaseDetailController,
  createReviewWheelController,
  filterReviewAnnotations,
  reviewNotebookMarkup,
} from '../src/review-reader-interactions.js';

test('wheel threshold turns once and ignores momentum during cooldown', () => {
  const moves = [];
  let now = 1000;
  const controller = createReviewWheelController({
    navigate: (direction) => moves.push(direction),
    clock: () => now,
    threshold: 58,
    cooldown: 900,
  });

  assert.equal(controller.push(20), false);
  assert.equal(controller.push(40), true);
  assert.deepEqual(moves, [1]);
  assert.equal(controller.push(120), false);
  assert.deepEqual(moves, [1]);

  now = 2000;
  assert.equal(controller.push(-70), true);
  assert.deepEqual(moves, [1, -1]);
});

test('wheel reset clears an incomplete gesture', () => {
  const moves = [];
  const controller = createReviewWheelController({
    navigate: (direction) => moves.push(direction),
    threshold: 60,
  });

  controller.push(40);
  controller.reset();
  controller.push(30);
  assert.deepEqual(moves, []);
});

test('annotation filters separate highlights from written notes', () => {
  const annotations = [
    { id: 'a', kind: 'highlight', quote: '高亮句子' },
    { id: 'b', kind: 'note', quote: '批注句子', note: '我的想法' },
  ];

  assert.deepEqual(filterReviewAnnotations(annotations, 'all'), annotations);
  assert.deepEqual(filterReviewAnnotations(annotations, 'highlight'), [annotations[0]]);
  assert.deepEqual(filterReviewAnnotations(annotations, 'note'), [annotations[1]]);
});

test('notebook markup escapes reader-authored quote and note content', () => {
  const html = reviewNotebookMarkup([{
    id: 'note-1',
    kind: 'note',
    chapter: 'origin',
    page: 1,
    quote: '<img src=x onerror=alert(1)>',
    note: '<script>alert(1)</script>',
  }]);

  assert.match(html, /data-review-annotation-id="note-1"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('an empty notebook explains how to create the first highlight', () => {
  assert.match(reviewNotebookMarkup([]), /选择正文中的任意文字/);
});

test('case detail enlarges the whole authored callout and restores trigger focus on close', () => {
  let cloned = 0;
  let removedActions = 0;
  let closeFocused = 0;
  let triggerFocused = 0;
  const clone = {
    querySelector(selector) {
      return selector === '.review-callout-actions' ? { remove() { removedActions += 1; } } : null;
    },
  };
  const callout = {
    cloneNode(deep) {
      assert.equal(deep, true);
      cloned += 1;
      return clone;
    },
  };
  const content = {
    child: null,
    replaceChildren(child) { this.child = child; },
  };
  const detail = {
    hidden: true,
    classList: { add() {}, remove() {} },
  };
  const closeButton = { focus() { closeFocused += 1; } };
  const trigger = { focus() { triggerFocused += 1; } };
  const controller = createReviewCaseDetailController({
    detail,
    content,
    closeButton,
  });

  controller.open(callout, trigger);
  assert.equal(detail.hidden, false);
  assert.equal(content.child, clone);
  assert.equal(cloned, 1);
  assert.equal(removedActions, 1);
  assert.equal(closeFocused, 1);

  controller.close();
  assert.equal(detail.hidden, true);
  assert.equal(triggerFocused, 1);
});
