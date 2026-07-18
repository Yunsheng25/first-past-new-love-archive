import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRoute, routeHref } from '../src/router.js';

test('parseRoute defaults an empty hash to intro', () => {
  assert.deepEqual(parseRoute(''), { name: 'intro' });
});

test('parseRoute recognizes static routes', () => {
  assert.deepEqual(parseRoute('#film'), { name: 'film' });
  assert.deepEqual(parseRoute('#after'), { name: 'after' });
  assert.deepEqual(parseRoute('#review'), { name: 'review-index' });
  assert.deepEqual(parseRoute('#archive'), { name: 'archive-index' });
});

test('parseRoute recognizes a review page route', () => {
  assert.deepEqual(parseRoute('#review/production/3'), {
    name: 'review-page',
    chapter: 'production',
    page: 3,
  });
});

test('parseRoute recognizes an archive detail route', () => {
  assert.deepEqual(parseRoute('#archive/case-12'), {
    name: 'archive-detail',
    id: 'case-12',
  });
});

test('parseRoute decodes dynamic segments and clamps page numbers to one', () => {
  assert.deepEqual(parseRoute('#review/%E5%88%9D%E6%81%8B/0'), {
    name: 'review-page',
    chapter: '初恋',
    page: 1,
  });
  assert.deepEqual(parseRoute('#archive/%E5%88%9D%E6%81%8B'), {
    name: 'archive-detail',
    id: '初恋',
  });
});

test('parseRoute falls back to intro for unknown routes', () => {
  assert.deepEqual(parseRoute('#unknown'), { name: 'intro' });
});

test('parseRoute falls back to intro for empty or malformed dynamic segments', () => {
  assert.deepEqual(parseRoute('#archive/'), { name: 'intro' });
  assert.deepEqual(parseRoute('#review//2'), { name: 'intro' });
  assert.deepEqual(parseRoute('#archive/%E0%A4%A'), { name: 'intro' });
  assert.deepEqual(parseRoute('#review/%E0%A4%A/2'), { name: 'intro' });
});

test('routeHref encodes Chinese dynamic ids', () => {
  assert.equal(routeHref('archive-detail', { id: '初恋 档案' }), '#archive/%E5%88%9D%E6%81%8B%20%E6%A1%A3%E6%A1%88');
});

test('routeHref creates hashes for every route type', () => {
  assert.equal(routeHref('intro'), '');
  assert.equal(routeHref('film'), '#film');
  assert.equal(routeHref('after'), '#after');
  assert.equal(routeHref('review-index'), '#review');
  assert.equal(routeHref('review-page', { chapter: 'production', page: 3 }), '#review/production/3');
  assert.equal(routeHref('archive-index'), '#archive');
  assert.equal(routeHref('unknown'), '');
});

test('routeHref falls back to intro when required dynamic params are empty', () => {
  assert.equal(routeHref('archive-detail'), '');
  assert.equal(routeHref('archive-detail', { id: '' }), '');
  assert.equal(routeHref('review-page'), '');
  assert.equal(routeHref('review-page', { chapter: '', page: 1 }), '');
});

test('review chapter hashes encode and decode Chinese text', () => {
  const href = routeHref('review-page', { chapter: '初恋制作', page: 2 });
  assert.equal(href, '#review/%E5%88%9D%E6%81%8B%E5%88%B6%E4%BD%9C/2');
  assert.deepEqual(parseRoute(href), { name: 'review-page', chapter: '初恋制作', page: 2 });
});

test('dynamic routes round-trip through routeHref and parseRoute', () => {
  const review = { name: 'review-page', chapter: 'production', page: 3 };
  const archive = { name: 'archive-detail', id: 'case-12' };

  assert.deepEqual(parseRoute(routeHref(review.name, review)), review);
  assert.deepEqual(parseRoute(routeHref(archive.name, archive)), archive);
});
