import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewServer, parseByteRange } from '../scripts/preview-server.mjs';

test('preview server resolves browser video byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
});

test('preview server rejects invalid or unsatisfiable ranges', () => {
  assert.equal(parseByteRange('bytes=1000-1100', 1000), null);
  assert.equal(parseByteRange('not-a-range', 1000), null);
});

test('preview server serves lightweight tunnel derivatives as WebP images', async (t) => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/assets/archive-display/001-2.webp`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
});
