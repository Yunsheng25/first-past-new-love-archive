import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextCharacters } from '../src/text-motion.js';

test('splitTextCharacters preserves spaces and punctuation', () => {
  assert.deepEqual(splitTextCharacters('初恋 · 旧爱'), ['初', '恋', ' ', '·', ' ', '旧', '爱']);
});
