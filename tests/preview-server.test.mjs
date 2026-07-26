import test from 'node:test';
import assert from 'node:assert/strict';

import { parseByteRange } from '../scripts/preview-server.mjs';

test('preview server resolves browser video byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
});

test('preview server rejects invalid or unsatisfiable ranges', () => {
  assert.equal(parseByteRange('bytes=1000-1100', 1000), null);
  assert.equal(parseByteRange('not-a-range', 1000), null);
});
