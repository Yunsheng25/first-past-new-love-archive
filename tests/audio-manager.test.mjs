import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('原创钢琴 BGM 是可循环的本地 PCM WAV', async () => {
  const wav = await readFile(new URL('../assets/audio/memory-piano.wav', import.meta.url));
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  const audioFormat = wav.readUInt16LE(20);
  const sampleRate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const bits = wav.readUInt16LE(34);
  const dataBytes = wav.readUInt32LE(40);
  const duration = dataBytes / (sampleRate * channels * bits / 8);
  assert.equal(audioFormat, 1);
  assert.equal(sampleRate, 44100);
  assert.equal(channels, 2);
  assert.equal(bits, 16);
  assert.ok(duration >= 31.9 && duration <= 32.1);
});
