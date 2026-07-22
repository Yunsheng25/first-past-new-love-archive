const MPEG1_LAYER3_BITRATES = Object.freeze([
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
]);
const MPEG2_LAYER3_BITRATES = Object.freeze([
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
]);
const MPEG1_SAMPLE_RATES = Object.freeze([44100, 48000, 32000]);

function invalid(message = 'invalid MP3') {
  throw new Error(message);
}

function id3v2End(bytes) {
  if (bytes.length < 3 || bytes.toString('ascii', 0, 3) !== 'ID3') return 0;
  if (bytes.length < 10) invalid('truncated MP3 ID3v2 tag');
  const sizeBytes = bytes.subarray(6, 10);
  if (sizeBytes.some((byte) => byte > 0x7f)) invalid('invalid MP3 ID3v2 size');
  const size = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
  const end = 10 + size + ((bytes[5] & 0x10) === 0x10 ? 10 : 0);
  if (end > bytes.length) invalid('truncated MP3 ID3v2 tag');
  return end;
}

function parseFrameHeader(bytes, offset) {
  if (offset + 4 > bytes.length) invalid('truncated MP3 frame header');
  const header = bytes.readUInt32BE(offset);
  if ((header >>> 21) !== 0x7ff) return null;

  const versionBits = (header >>> 19) & 0x3;
  const layerBits = (header >>> 17) & 0x3;
  const bitrateIndex = (header >>> 12) & 0xf;
  const sampleRateIndex = (header >>> 10) & 0x3;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const mpeg1 = versionBits === 3;
  const divisor = mpeg1 ? 1 : versionBits === 2 ? 2 : 4;
  const bitrate = (mpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex] * 1000;
  const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / divisor;
  const padding = (header >>> 9) & 1;
  const frameLength = Math.floor((mpeg1 ? 144 : 72) * bitrate / sampleRate) + padding;
  return { bitrate, sampleRate, frameLength, samples: mpeg1 ? 1152 : 576 };
}

export function probeMp3(input) {
  if (!(input instanceof Uint8Array)) invalid();
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let offset = id3v2End(bytes);
  const audioStart = offset;
  const hasId3v1 = bytes.length >= 128 && bytes.toString('ascii', bytes.length - 128, bytes.length - 125) === 'TAG';
  const audioEnd = hasId3v1 ? bytes.length - 128 : bytes.length;
  let frameCount = 0;
  let totalSamples = 0;
  let sampleRate;

  while (offset < audioEnd) {
    if (audioEnd - offset < 4) invalid('truncated MP3 frame header');
    const frame = parseFrameHeader(bytes, offset);
    if (!frame) invalid(frameCount === 0 ? 'invalid MP3' : 'invalid MP3 trailing data');
    if (offset + frame.frameLength > audioEnd) invalid('truncated MP3 frame');
    if (sampleRate !== undefined && frame.sampleRate !== sampleRate) invalid('invalid MP3 sample-rate change');
    sampleRate = frame.sampleRate;
    totalSamples += frame.samples;
    frameCount += 1;
    offset += frame.frameLength;
  }

  if (frameCount === 0 || offset !== audioEnd) invalid();
  const duration = totalSamples / sampleRate;
  const bitrate = Math.round(((audioEnd - audioStart) * 8) / duration);
  return Object.freeze({
    duration,
    sampleRate,
    bitrate,
    frameCount,
    audioStreams: 1,
    videoStreams: 0,
  });
}
