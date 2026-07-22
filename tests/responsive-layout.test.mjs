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

test('mobile tunnel keeps its wordmark and both view controls inside the viewport', () => {
  const mobileTunnelStart = css.indexOf('@media (max-width: 760px)', css.indexOf('.archive-tunnel-view'));
  assert.notEqual(mobileTunnelStart, -1, 'missing mobile tunnel rules');
  const nextMediaQuery = css.indexOf('@media ', mobileTunnelStart + 1);
  const mobileTunnelCss = css.slice(mobileTunnelStart, nextMediaQuery === -1 ? css.length : nextMediaQuery);

  assert.match(mobileTunnelCss, /\.archive-tunnel-header\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(mobileTunnelCss, /\.archive-tunnel-actions\s*\{[^}]*width:\s*100%;[^}]*flex-direction:\s*row;[^}]*justify-content:\s*flex-end;/s);
  assert.match(mobileTunnelCss, /\.archive-tunnel-actions button\s*\{[^}]*min-width:\s*0;[^}]*padding:\s*9px 14px;/s);
});

test('mobile tunnel scales only its card bases so the nearest card stays below 95vw', () => {
  const mobileTunnelStart = css.indexOf('@media (max-width: 760px)', css.indexOf('.archive-tunnel-view'));
  const mobileTunnelCss = css.slice(mobileTunnelStart);
  const width = Number(mobileTunnelCss.match(/\.archive-tunnel-card\s*\{[^}]*width:\s*(\d+)px/s)?.[1]);
  const portrait = Number(mobileTunnelCss.match(/\.archive-tunnel-card--portrait\s*\{[^}]*height:\s*(\d+)px/s)?.[1]);
  const tall = Number(mobileTunnelCss.match(/\.archive-tunnel-card--tall\s*\{[^}]*height:\s*(\d+)px/s)?.[1]);
  const landscape = Number(mobileTunnelCss.match(/\.archive-tunnel-card--landscape\s*\{[^}]*height:\s*(\d+)px/s)?.[1]);

  assert.ok(width > 0 && width <= 132, `mobile base width ${width} must keep the near 2.72x card within 95vw at 390px`);
  assert.ok(portrait > tall && tall > landscape && landscape > 0, 'mobile aspect hierarchy must remain readable');
});

test('the document declares an inline icon so first load has no favicon 404', () => {
  assert.match(html, /<link\s+rel="icon"\s+href="data:,"\s*\/?>/);
});

test('mobile review reader keeps its paper, drawer, media, and navigation inside the viewport', () => {
  const mobile = mediaBlock(css, '@media (max-width: 760px)');

  assert.match(mobile, /\.review-reader-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(mobile, /\.review-paper\s*\{[^}]*margin:\s*10px 9px calc\(env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*12px\)/s);
  assert.match(mobile, /\.review-paper-content\s*\{[^}]*width:\s*min\(100% - 30px,\s*680px\)/s);
  assert.match(mobile, /\.review-chapter-drawer\s*\{[^}]*z-index:\s*60[^}]*width:\s*min\(88vw,\s*360px\)[^}]*background:\s*#171411/s);
  assert.match(mobile, /\.review-media img,[\s\S]*?\.review-media video\s*\{[^}]*max-height:\s*56dvh/s);
  assert.match(mobile, /\.review-page-nav\s*\{[^}]*padding:\s*7px 14px/s);
});

test('390px review reader models paper-child navigation containment and locally scrolls long content', () => {
  // Chrome 390px evidence: paper x=12/w=366; its border-box child nav x=13/w=364.
  const viewportWidth = 390;
  const globalBoxSizing = declarationBlock(css, '*');
  const basePaper = declarationBlock(css, '.review-paper');
  const mobile = mediaBlock(css, '@media (max-width: 760px)');
  const narrow = mediaBlock(css, '@media (max-width: 420px)');
  const paper = declarationBlock(narrow, '.review-paper');
  const widthMatch = paper.match(/width:\s*calc\(100vw\s*-\s*(\d+)px\)/);
  const borderMatch = basePaper.match(/border:\s*(\d+)px\s+solid/);
  const nav = declarationBlock(narrow, '.review-page-nav');
  const navMaxWidthMatch = nav.match(/max-width:\s*(\d+)%/);
  const mobileNav = declarationBlock(mobile, '.review-page-nav');
  const navPaddingMatch = mobileNav.match(/padding:\s*\d+px\s+(\d+)px/);

  assert.ok(widthMatch, 'paper must use a viewport-bounded width calculation');
  assert.ok(borderMatch, 'paper must expose a measurable border for its child containing block');
  assert.ok(navMaxWidthMatch, 'navigation must declare a percentage max width');
  assert.ok(navPaddingMatch, 'mobile navigation must declare horizontal padding');
  assert.match(globalBoxSizing, /box-sizing:\s*border-box/);
  const inset = Number(widthMatch[1]);
  const borderWidth = Number(borderMatch[1]);
  const paperWidth = viewportWidth - inset;
  const paperInnerWidth = paperWidth - (borderWidth * 2);
  const navPercentage = Number(navMaxWidthMatch[1]);
  const navUpperBound = (paperInnerWidth * navPercentage) / 100;
  const navHorizontalPadding = Number(navPaddingMatch[1]);
  const navGridContentWidth = navUpperBound - (navHorizontalPadding * 2);

  assert.ok(inset > 0 && inset < viewportWidth, 'paper inset must be a positive value smaller than the viewport');
  assert.equal(paperWidth, 366);
  assert.equal(paperInnerWidth, 364, 'a 1px border on each side leaves the child containing block at 364px');
  assert.ok(paperWidth > 0 && paperWidth <= viewportWidth, 'paper border box must stay inside the viewport');
  assert.match(paper, /box-sizing:\s*border-box/);
  assert.match(paper, /max-width:\s*100%/);
  assert.match(paper, /padding:\s*0/);
  for (const selector of ['.review-reader-view', '.review-reader-layout', '.review-paper-content', '.review-blocks', '.review-media']) {
    const rule = declarationBlock(narrow, selector);
    assert.match(rule, /min-width:\s*0/);
    assert.match(rule, /max-width:\s*100%/);
  }
  assert.match(declarationBlock(narrow, '.review-paper-content pre'), /overflow-x:\s*auto/);
  assert.match(declarationBlock(narrow, '.review-paper-content table'), /overflow-x:\s*auto/);
  const drawer = declarationBlock(narrow, '.review-chapter-drawer');
  assert.match(drawer, /width:\s*min\(calc\(100vw\s*-\s*20px\),\s*360px\)/);
  const drawerWidth = Math.min(viewportWidth - 20, 360);
  assert.equal(drawerWidth, 360);
  assert.ok(drawerWidth <= viewportWidth, 'drawer width must fit the viewport');
  assert.equal(navUpperBound, 364, '100% navigation max width resolves against the paper content box');
  assert.ok(navUpperBound > 0 && navUpperBound <= paperInnerWidth, 'navigation upper bound must fit its paper containing block');
  assert.equal(navHorizontalPadding, 14);
  assert.ok(navGridContentWidth > 0, 'navigation grid must retain positive content width after horizontal padding');
  assert.match(nav, /grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\)/);
});

test('390x844 review controls retain separate safe-area-relative vertical slots', () => {
  const mobile = mediaBlock(css, '@media (max-width: 760px)');
  const returnControl = declarationBlock(mobile, '.review-return-after');
  const nav = declarationBlock(mobile, '.review-page-nav');
  const bgm = declarationBlock(css, '.bgm-toggle');
  const viewportHeight = 844;
  const navHeight = Number(nav.match(/min-height:\s*(\d+)px/)?.[1]);
  const paperBottomOffset = 12;
  const returnHeight = Number(returnControl.match(/min-height:\s*(\d+)px/)?.[1]);
  const returnOffset = Number(returnControl.match(/bottom:\s*calc\(env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*(\d+)px\)/)?.[1]);
  const bgmHeight = Number(bgm.match(/min-height:\s*(\d+)px/)?.[1]);
  const bgmOffset = Number(bgm.match(/inset-block-end:\s*calc\(env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*(\d+)px\)/)?.[1]);
  assert.equal(returnOffset, 68);
  assert.equal(bgmOffset, 120);
  for (const [safeArea, expected] of [[0, [[782, 832], [732, 776], [680, 724]]], [20, [[762, 812], [712, 756], [660, 704]]], [34, [[748, 798], [698, 742], [646, 690]]], [48, [[734, 784], [684, 728], [632, 676]]]]) {
    const navRange = [viewportHeight - safeArea - paperBottomOffset - navHeight, viewportHeight - safeArea - paperBottomOffset];
    const returnRange = [viewportHeight - safeArea - returnOffset - returnHeight, viewportHeight - safeArea - returnOffset];
    const bgmRange = [viewportHeight - safeArea - bgmOffset - bgmHeight, viewportHeight - safeArea - bgmOffset];
    assert.deepEqual([navRange, returnRange, bgmRange], expected, `safe area ${safeArea}px`);
    assert.ok(navRange[1] <= viewportHeight - safeArea - paperBottomOffset, `navigation must clear system UI at safe area ${safeArea}px`);
    assert.ok(returnRange[1] < navRange[0], `return control must clear navigation at safe area ${safeArea}px`);
    assert.ok(bgmRange[1] + 8 <= returnRange[0], `BGM must clear return control at safe area ${safeArea}px`);
  }
});
