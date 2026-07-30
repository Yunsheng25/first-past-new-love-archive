import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');

test('application keeps the darkroom UI without importing the media manifest or loader', () => {
  assert.match(script, /from '\.\/src\/preloader-ui\.js'/);
  assert.doesNotMatch(script, /from '\.\/preload-manifest\.js'/);
  assert.doesNotMatch(script, /from '\.\/src\/site-preloader\.js'/);
});

test('application reveals its first route without a media network gate', () => {
  const boot = script.match(/async function bootSite\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(boot, /await revealSite\(\)/);
  assert.doesNotMatch(boot, /fetch\(|preloadAssets|preloadInBackground|runFullSitePreload/);
  const reveal = script.match(/async function revealSite\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(reveal, /siteReady = true/);
  assert.match(reveal, /reviewTurnController\.renderInitial\(currentRoute\(\)\)/);
  assert.equal(
    (script.match(/reviewTurnController\.renderInitial\(currentRoute\(\)\)/g) ?? []).length,
    1,
  );
});

test('application never starts a whole-site background media transfer', () => {
  assert.match(script, /if \(!siteReady\) return;/);
  assert.match(script, /preloaderUI\.fail\(error\)/);
  assert.match(script, /onRetry:\s*\(\) => void bootSite\(\)/);
  assert.match(script, /assets:\s*\[\]/);
  assert.doesNotMatch(script, /PRELOAD_ASSETS/);
  assert.doesNotMatch(script, /preloadAssets|preloadInBackground|selectCriticalAssets/);
  assert.doesNotMatch(script, /runFullSitePreload/);
});
