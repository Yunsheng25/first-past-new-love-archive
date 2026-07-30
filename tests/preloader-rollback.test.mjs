import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');

test('rollback restores the previously published media warmup path', () => {
  assert.match(script, /from '\.\/preload-manifest\.js'/);
  assert.match(script, /from '\.\/src\/site-preloader\.js'/);
  assert.match(script, /selectCriticalAssets\(PRELOAD_ASSETS,\s*currentRoute\(\)\.name\)/);
  assert.match(script, /preloadInBackground/);
});
