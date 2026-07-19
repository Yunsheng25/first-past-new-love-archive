import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function mediaBlock(css, query) {
  const start = css.indexOf(query);
  assert.notEqual(start, -1, `missing ${query}`);
  const end = css.indexOf('@media ', start + query.length);
  return css.slice(start, end === -1 ? css.length : end);
}

function declarationBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule for ${selector}`);
  const bodyStart = start + selector.length + 2;
  return css.slice(bodyStart, css.indexOf('}', bodyStart));
}

test('mobile archive stacks filters before results in normal document flow', () => {
  const mobileArchiveStart = css.indexOf('@media (max-width: 760px)', css.indexOf('/* Prompt and image archive.'));
  const nextMediaQuery = css.indexOf('@media ', mobileArchiveStart + 1);
  const mobileArchiveCss = css.slice(mobileArchiveStart, nextMediaQuery);

  assert.match(
    mobileArchiveCss,
    /\.archive-index-main\s*\{[^}]*display:\s*block;/s,
    'the mobile scroll container must use block flow so filter content cannot overlap the case grid',
  );
});

test('the document declares an inline icon so first load has no favicon 404', () => {
  assert.match(html, /<link\s+rel="icon"\s+href="data:,"\s*\/?>/);
});

test('mobile review reader keeps its paper, drawer, media, and navigation inside the viewport', () => {
  const mobile = mediaBlock(css, '@media (max-width: 760px)');

  assert.match(mobile, /\.review-reader-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(mobile, /\.review-paper\s*\{[^}]*margin:\s*10px 9px 12px/s);
  assert.match(mobile, /\.review-paper-content\s*\{[^}]*width:\s*min\(100% - 30px,\s*680px\)/s);
  assert.match(mobile, /\.review-chapter-drawer\s*\{[^}]*z-index:\s*60[^}]*width:\s*min\(88vw,\s*360px\)[^}]*background:\s*#171411/s);
  assert.match(mobile, /\.review-media img,[\s\S]*?\.review-media video\s*\{[^}]*max-height:\s*56dvh/s);
  assert.match(mobile, /\.review-page-nav\s*\{[^}]*padding:\s*7px 14px/s);
});

test('390px review reader containment is explicit and locally scrolls long content', () => {
  const narrow = mediaBlock(css, '@media (max-width: 420px)');
  const paper = declarationBlock(narrow, '.review-paper');
  const widthMatch = paper.match(/width:\s*calc\(100vw\s*-\s*(\d+)px\)/);

  assert.ok(widthMatch, 'paper must use a viewport-bounded width calculation');
  assert.ok(390 - Number(widthMatch[1]) <= 390, '390px paper width must not exceed the viewport');
  assert.match(paper, /box-sizing:\s*border-box/);
  assert.match(paper, /max-width:\s*100%/);
  for (const selector of ['.review-reader-view', '.review-reader-layout', '.review-paper-content', '.review-blocks', '.review-media', '.review-page-nav']) {
    const rule = declarationBlock(narrow, selector);
    assert.match(rule, /min-width:\s*0/);
    assert.match(rule, /max-width:\s*100%/);
  }
  assert.match(declarationBlock(narrow, '.review-paper-content pre'), /overflow-x:\s*auto/);
  assert.match(declarationBlock(narrow, '.review-paper-content table'), /overflow-x:\s*auto/);
  assert.match(declarationBlock(narrow, '.review-chapter-drawer'), /width:\s*min\(calc\(100vw\s*-\s*20px\),\s*360px\)/);
  assert.match(declarationBlock(narrow, '.review-page-nav'), /grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\)/);
});
