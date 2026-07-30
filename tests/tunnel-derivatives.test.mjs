import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('derivative builder emits one bounded WebP per unique archive image', () => {
  const result = spawnSync('python', ['scripts/build-tunnel-derivatives.py', '--check'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.count, 137);
  assert.ok(manifest.totalBytes <= 55 * 1024 * 1024, `${manifest.totalBytes} exceeds 55 MiB`);
  assert.ok(manifest.items.every((item) => item.width <= 1280 && item.height <= 1280));
  assert.ok(manifest.items.every((item) => item.format === 'WEBP'));
  assert.equal(new Set(manifest.items.map((item) => item.source)).size, 137);
  assert.equal(new Set(manifest.items.map((item) => item.display)).size, 137);
});
