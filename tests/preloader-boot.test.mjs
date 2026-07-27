import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');

test('application imports the full manifest, loader and darkroom UI', () => {
  assert.match(script, /from '\.\/preload-manifest\.js'/);
  assert.match(script, /from '\.\/src\/site-preloader\.js'/);
  assert.match(script, /from '\.\/src\/preloader-ui\.js'/);
});

test('application renders its first route after route-critical assets preload', () => {
  const boot = script.match(/async function bootSite\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(boot, /await runFullSitePreload\(\)/);
  assert.match(boot, /await revealSite\(\)/);
  const reveal = script.match(/async function revealSite\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(reveal, /siteReady = true/);
  assert.match(reveal, /reviewTurnController\.renderInitial\(currentRoute\(\)\)/);
  assert.ok(
    boot.indexOf('await runFullSitePreload()') <
    boot.indexOf('await revealSite()'),
  );
  assert.equal(
    (script.match(/reviewTurnController\.renderInitial\(currentRoute\(\)\)/g) ?? []).length,
    1,
  );
});

test('hash navigation is gated during critical loading and remaining assets warm in background', () => {
  assert.match(script, /if \(!siteReady\) return;/);
  assert.match(script, /preloaderUI\.fail\(error\)/);
  assert.match(script, /onRetry:\s*\(\) => void bootSite\(\)/);
  assert.match(script, /selectCriticalAssets\(PRELOAD_ASSETS,\s*currentRoute\(\)\.name\)/);
  assert.match(script, /preloadInBackground/);
});
