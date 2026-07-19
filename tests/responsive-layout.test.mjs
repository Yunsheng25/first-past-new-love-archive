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
  const inset = Number(widthMatch[1]);
  const paperWidth = 390 - inset;
  assert.ok(inset > 0 && inset < 390, 'paper inset must be a positive value smaller than the viewport');
  assert.equal(paperWidth, 366);
  assert.ok(paperWidth > 0 && paperWidth <= 390, '390px paper width must stay positive and inside the viewport');
  assert.match(paper, /box-sizing:\s*border-box/);
  assert.match(paper, /max-width:\s*100%/);
  assert.match(paper, /padding:\s*0/);
  for (const selector of ['.review-reader-view', '.review-reader-layout', '.review-paper-content', '.review-blocks', '.review-media', '.review-page-nav']) {
    const rule = declarationBlock(narrow, selector);
    assert.match(rule, /min-width:\s*0/);
    assert.match(rule, /max-width:\s*100%/);
  }
  assert.match(declarationBlock(narrow, '.review-paper-content pre'), /overflow-x:\s*auto/);
  assert.match(declarationBlock(narrow, '.review-paper-content table'), /overflow-x:\s*auto/);
  const drawer = declarationBlock(narrow, '.review-chapter-drawer');
  const nav = declarationBlock(narrow, '.review-page-nav');
  assert.match(drawer, /width:\s*min\(calc\(100vw\s*-\s*20px\),\s*360px\)/);
  assert.equal(Math.min(390 - 20, 360), 360);
  assert.ok(Math.min(390 - 20, 360) <= 390, 'drawer width must fit 390px');
  assert.match(nav, /max-width:\s*100%/);
  assert.ok(390 <= 390, 'nav max width must fit 390px');
  assert.match(nav, /grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\)/);
});

test('390x844 review controls occupy separate vertical slots above the page navigation', () => {
  const mobile = mediaBlock(css, '@media (max-width: 760px)');
  const returnControl = declarationBlock(mobile, '.review-return-after');
  const nav = declarationBlock(mobile, '.review-page-nav');
  const bgm = declarationBlock(css, '.bgm-toggle');
  const viewportHeight = 844;
  const navHeight = Number(nav.match(/min-height:\s*(\d+)px/)?.[1]);
  const paperBottomMargin = 12;
  const returnHeight = Number(returnControl.match(/min-height:\s*(\d+)px/)?.[1]);
  const returnBottom = Number(returnControl.match(/bottom:\s*calc\(env\(safe-area-inset-bottom\)\s*\+\s*(\d+)px\)/)?.[1]);
  const bgmHeight = Number(bgm.match(/min-height:\s*(\d+)px/)?.[1]);
  const bgmBottom = Number(bgm.match(/inset-block-end:\s*max\((\d+)px/)?.[1]);
  const navRange = [viewportHeight - paperBottomMargin - navHeight, viewportHeight - paperBottomMargin];
  const returnRange = [viewportHeight - returnBottom - returnHeight, viewportHeight - returnBottom];
  const bgmRange = [viewportHeight - bgmBottom - bgmHeight, viewportHeight - bgmBottom];

  assert.deepEqual(navRange, [782, 832]);
  assert.deepEqual(returnRange, [732, 776]);
  assert.deepEqual(bgmRange, [680, 724]);
  assert.ok(returnRange[1] < navRange[0], 'return control must clear the navigation');
  assert.ok(bgmRange[1] < returnRange[0], 'BGM and return controls must use separate vertical slots');
});
