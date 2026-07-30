import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenReviewPages,
  resolveReviewSpread,
} from '../src/review-spread.js';

const review = {
  chapters: [
    {
      slug: 'origin',
      title: '项目缘起',
      pages: [
        [{ type: 'text', text: '第一页' }],
        [{ type: 'text', text: '第二页' }],
      ],
    },
    {
      slug: 'story',
      title: '故事设计',
      pages: [[{ type: 'text', text: '第三页' }]],
    },
  ],
};

test('flattenReviewPages preserves chapter and page source order', () => {
  assert.deepEqual(
    flattenReviewPages(review).map((page) => page.href),
    ['#review/origin/1', '#review/origin/2', '#review/story/1'],
  );
});

test('resolveReviewSpread pairs the current page with its facing page', () => {
  const spread = resolveReviewSpread(review, 'origin', 1);

  assert.equal(spread.left.href, '#review/origin/1');
  assert.equal(spread.right.href, '#review/origin/2');
  assert.equal(spread.previousHref, null);
  assert.equal(spread.nextHref, '#review/story/1');
  assert.equal(spread.overallStart, 1);
});

test('the second page resolves to the same spread and a final odd page has a blank facing side', () => {
  assert.equal(resolveReviewSpread(review, 'origin', 2).left.href, '#review/origin/1');

  const final = resolveReviewSpread(review, 'story', 1);
  assert.equal(final.left.href, '#review/story/1');
  assert.equal(final.right, null);
  assert.equal(final.previousHref, '#review/origin/1');
  assert.equal(final.nextHref, null);
  assert.equal(final.overallStart, 3);
});

test('missing chapters and invalid page numbers return null', () => {
  assert.equal(resolveReviewSpread(review, 'missing', 1), null);
  assert.equal(resolveReviewSpread(review, 'origin', 0), null);
  assert.equal(resolveReviewSpread(review, 'origin', 99), null);
});
