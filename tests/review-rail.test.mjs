import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewRail, reviewRailMarkup } from '../src/review-rail.js';

const data = {
  chapters: [
    { slug: 'one', title: '第一章', pages: [[{ type: 'text', section: '开场' }], [{ type: 'callout', section: '案例' }]] },
    { slug: 'two', title: '第二章', pages: [[{ type: 'text', section: '继续' }], [{ type: 'text', section: '结尾' }]] },
  ],
};

test('rail emits chapter, case and page ticks in source order with one current item', () => {
  const items = buildReviewRail(data, { chapter: data.chapters[0], pageIndex: 1 });
  assert.deepEqual(items.map((item) => item.kind), ['chapter', 'case', 'chapter', 'page']);
  assert.deepEqual(items.map((item) => item.order), [0, 1, 2, 3]);
  assert.equal(items.filter((item) => item.current).length, 1);
  assert.equal(items[1].href, '#review/one/2');
});

test('rail markup exposes quiet ticks, hover labels and current page semantics', () => {
  const html = reviewRailMarkup(buildReviewRail(data, { chapter: data.chapters[1], pageIndex: 0 }));
  assert.match(html, /data-review-rail/);
  assert.match(html, /is-case/);
  assert.match(html, /is-current[^"]*"[^>]*aria-current="page"/);
  assert.match(html, />第二章<\/span>/);
});
