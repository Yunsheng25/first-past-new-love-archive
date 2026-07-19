import { mkdir, writeFile } from 'node:fs/promises';

const sampleRate = 44100;
const seconds = 32;
const channels = 2;
const frames = sampleRate * seconds;
const pcm = Buffer.alloc(frames * channels * 2);
const notes = [
  [0, 52], [0, 59], [0, 64], [4, 55], [4, 60], [4, 64],
  [8, 48], [8, 55], [8, 60], [12, 50], [12, 57], [12, 62],
  [16, 52], [16, 59], [16, 64], [20, 55], [20, 60], [20, 67],
  [24, 48], [24, 55], [24, 64], [28, 50], [28, 57], [28, 62],
];
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const voice = (time, start, midi) => {
  const age = time - start;
  if (age < 0 || age >= 4) return 0;
  const attack = Math.min(1, age / 0.025);
  const release = Math.min(1, (4 - age) / 0.7);
  const envelope = attack * release * Math.exp(-age * 0.72);
  const phase = 2 * Math.PI * frequency(midi) * age;
  return envelope * (Math.sin(phase) + 0.32 * Math.sin(phase * 2.01) + 0.12 * Math.sin(phase * 3.97));
};

for (let frame = 0; frame < frames; frame += 1) {
  const time = frame / sampleRate;
  const sample = Math.tanh(notes.reduce((sum, [start, midi]) => sum + voice(time, start, midi), 0) * 0.22);
  const edge = Math.min(1, time / 0.03, (seconds - time) / 0.03);
  const value = Math.round(Math.max(-1, Math.min(1, sample * edge)) * 32767);
  pcm.writeInt16LE(value, frame * 4);
  pcm.writeInt16LE(value, frame * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);

await mkdir(new URL('../assets/audio/', import.meta.url), { recursive: true });
await writeFile(new URL('../assets/audio/memory-piano.wav', import.meta.url), Buffer.concat([header, pcm]));
