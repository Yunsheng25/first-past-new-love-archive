import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

async function walk(directory) {
  const items = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(items.map((item) => {
    const entry = path.join(directory, item.name);
    return item.isDirectory() ? walk(entry) : [entry];
  }));
  return files.flat();
}

test('preload manifest contains every public asset once with exact byte sizes', async () => {
  const source = await readFile(path.join(ROOT, 'preload-manifest.js'), 'utf8');
  const json = source.match(/Object\.freeze\((\[[\s\S]*?\])\);/)?.[1];
  assert.ok(json, 'manifest array is exported');

  const entries = JSON.parse(json);
  assert.equal(new Set(entries.map((entry) => entry.path)).size, entries.length);

  for (const entry of entries) {
    const info = await stat(path.join(ROOT, entry.path));
    assert.equal(entry.bytes, info.size, entry.path);
  }

  const expected = (await walk(path.join(ROOT, 'assets')))
    .map((entry) => path.relative(ROOT, entry).replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(entries.map((entry) => entry.path), expected);
});

test('preload manifest total equals the exact sum of all entries', async () => {
  const source = await readFile(path.join(ROOT, 'preload-manifest.js'), 'utf8');
  const json = source.match(/Object\.freeze\((\[[\s\S]*?\])\);/)?.[1];
  const total = Number(source.match(/PRELOAD_TOTAL_BYTES = (\d+);/)?.[1]);
  const entries = JSON.parse(json);
  assert.equal(total, entries.reduce((sum, entry) => sum + entry.bytes, 0));
});
