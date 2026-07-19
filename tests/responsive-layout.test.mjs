import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

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
