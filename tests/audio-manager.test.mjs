import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BGM_PREFERENCE_KEY,
  BGM_VOLUME,
  createAudioManager,
  createVolumeFade,
} from '../src/audio-manager.js';

function createFakeAudio({ playResult = Promise.resolve() } = {}) {
  return {
    volume: 1,
    loop: false,
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1;
      this.paused = false;
      return playResult;
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
  };
}

function createFakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    value(key) { return values.get(key); },
  };
}

function immediateFade(audio) {
  return async (_player, target) => { audio.volume = target; };
}

function createDeferredFade(audio) {
  const pending = [];
  const fade = (_player, target) => new Promise((resolve) => {
    pending.push({
      target,
      resolve() {
        audio.volume = target;
        resolve();
      },
    });
  });
  return { fade, pending };
}

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

test('starts from a gesture, enters film mode, and leaves it', async () => {
  const audio = createFakeAudio();
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  assert.equal(audio.playCalls, 0);
  assert.deepEqual(manager.state(), { enabled: true, gestureReceived: false, filmActive: false, unavailable: false, playing: false });

  assert.equal(await manager.startFromGesture(), true);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.loop, true);
  assert.equal(audio.volume, BGM_VOLUME);

  await manager.enterFilm();
  assert.equal(audio.volume, 0);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(manager.state().filmActive, true);

  assert.equal(await manager.leaveFilm(), true);
  assert.equal(audio.playCalls, 2);
  assert.equal(manager.state().filmActive, false);
});

test('toggle persists preference and disabled stored preference does not resume', async () => {
  const audio = createFakeAudio();
  const storage = createFakeStorage();
  const manager = createAudioManager({ audio, storage, fade: immediateFade(audio) });

  await manager.startFromGesture();
  assert.equal(await manager.toggle(), false);
  assert.equal(storage.value(BGM_PREFERENCE_KEY), 'false');
  assert.equal(audio.pauseCalls, 1);
  assert.equal(await manager.toggle(), true);
  assert.equal(storage.value(BGM_PREFERENCE_KEY), 'true');
  assert.equal(audio.playCalls, 2);

  const disabledAudio = createFakeAudio();
  const disabled = createAudioManager({
    audio: disabledAudio,
    storage: createFakeStorage({ [BGM_PREFERENCE_KEY]: 'false' }),
    fade: immediateFade(disabledAudio),
  });
  await disabled.startFromGesture();
  assert.equal(await disabled.leaveFilm(), false);
  assert.equal(disabled.state().enabled, false);
});

test('marks playback as unavailable when play is rejected', async () => {
  const audio = createFakeAudio({ playResult: Promise.reject(new Error('blocked')) });
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  assert.equal(await manager.startFromGesture(), false);
  assert.equal(manager.state().unavailable, true);
  assert.equal(audio.pauseCalls, 1);
});

test('volume fade interpolates to its target and settles immediately for zero duration', async () => {
  const audio = { volume: 0 };
  let clock = 0;
  const scheduled = [];
  const fade = createVolumeFade({
    now: () => clock,
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel() {},
  });

  await fade(audio, 0.7, 0);
  assert.equal(audio.volume, 0.7);

  const completion = fade(audio, 0.2, 100);
  clock = 50;
  scheduled.shift()();
  assert.ok(Math.abs(audio.volume - 0.45) < 1e-9);
  clock = 100;
  scheduled.shift()();
  await completion;
  assert.equal(audio.volume, 0.2);
});

test('destroy pauses and prevents future playback', async () => {
  const audio = createFakeAudio();
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  await manager.startFromGesture();
  manager.destroy();
  assert.equal(audio.pauseCalls, 1);
  assert.equal(await manager.leaveFilm(), false);
  assert.equal(audio.playCalls, 1);
});

test('startFromGesture is idempotent for sequential and concurrent gestures', async () => {
  let resolvePlay;
  const audio = createFakeAudio({
    playResult: new Promise((resolve) => { resolvePlay = resolve; }),
  });
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const first = manager.startFromGesture();
  const second = manager.startFromGesture();
  assert.equal(audio.playCalls, 1);
  resolvePlay();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);

  assert.equal(await manager.startFromGesture(), true);
  assert.equal(audio.playCalls, 1);
});

test('a stale enter-film fade cannot pause BGM after leaving film mode', async () => {
  let resolveFilmFade;
  const audio = createFakeAudio();
  const fade = async (_player, target) => {
    if (target === 0) await new Promise((resolve) => { resolveFilmFade = resolve; });
    audio.volume = target;
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  await manager.startFromGesture();
  const entering = manager.enterFilm();
  await manager.leaveFilm();
  resolveFilmFade();
  await entering;

  assert.equal(audio.paused, false);
  assert.equal(audio.pauseCalls, 0);
});

test('no available Audio safely enters film mode and disables BGM', async () => {
  const originalAudio = globalThis.Audio;
  try {
    delete globalThis.Audio;
    const storage = createFakeStorage();
    const fade = () => { throw new Error('fade must not receive a missing player'); };
    const manager = createAudioManager({ storage, fade });

    await assert.doesNotReject(manager.enterFilm());
    assert.equal(await manager.toggle(), false);
    assert.equal(storage.value(BGM_PREFERENCE_KEY), 'false');
    assert.deepEqual(manager.state(), { enabled: false, gestureReceived: false, filmActive: true, unavailable: true, playing: false });
  } finally {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

test('volume fade honors injected scheduler cancellation and settles superseded work', async () => {
  const scheduled = [];
  const cancelled = [];
  const fade = createVolumeFade({
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel(handle) { cancelled.push(handle); },
  });
  const audio = { volume: 1 };

  const first = fade(audio, 0, 100);
  assert.equal(scheduled.length, 1);
  const second = fade(audio, 0.5, 100);
  await first;
  assert.equal(cancelled.length, 1);
  fade.cancel();
  await second;
  assert.equal(cancelled.length, 2);

  await fade(audio, 0.4, -1);
  assert.equal(audio.volume, 0.4);
});

test('destroy during a fade settles the pending call without stale side effects', async () => {
  const audio = createFakeAudio();
  const pending = [];
  const fade = (_player, target) => new Promise((resolve) => { pending.push({ resolve, target }); });
  fade.cancel = () => pending.splice(0).forEach(({ resolve }) => resolve());
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  const start = manager.startFromGesture();
  await new Promise((resolve) => setImmediate(resolve));
  pending.shift().resolve();
  await start;
  const disabling = manager.toggle();
  manager.destroy();
  await disabling;

  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.playCalls, 1);
});

test('leaving film supersedes a stale fade and restores BGM volume while already playing', async () => {
  const audio = createFakeAudio();
  const { fade, pending } = createDeferredFade(audio);
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  const start = manager.startFromGesture();
  await new Promise((resolve) => setImmediate(resolve));
  pending.shift().resolve();
  await start;
  const entering = manager.enterFilm();
  const leaving = manager.leaveFilm();
  const staleFilmFade = pending.shift();
  const latestFade = pending.shift();
  staleFilmFade.resolve();
  latestFade.resolve();
  await Promise.all([entering, leaving]);

  assert.equal(audio.paused, false);
  assert.equal(audio.volume, BGM_VOLUME);
});

test('re-enabling BGM supersedes a stale disable fade', async () => {
  const audio = createFakeAudio();
  const { fade, pending } = createDeferredFade(audio);
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  const start = manager.startFromGesture();
  await new Promise((resolve) => setImmediate(resolve));
  pending.shift().resolve();
  await start;
  const disabling = manager.toggle();
  const enabling = manager.toggle();
  const staleDisableFade = pending.shift();
  const latestFade = pending.shift();
  latestFade.resolve();
  staleDisableFade.resolve();
  await Promise.all([disabling, enabling]);

  assert.deepEqual(manager.state(), { enabled: true, gestureReceived: true, filmActive: false, unavailable: false, playing: true });
  assert.equal(audio.volume, BGM_VOLUME);
  assert.equal(audio.pauseCalls, 0);
});

test('new film transition supersedes a pending start and leaves BGM playing', async () => {
  const audio = createFakeAudio();
  let firstPlay = true;
  audio.play = function play() {
    this.playCalls += 1;
    if (firstPlay) {
      firstPlay = false;
      return new Promise(() => {});
    }
    this.paused = false;
    return Promise.resolve();
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  const entering = manager.enterFilm();
  const leaving = manager.leaveFilm();
  assert.deepEqual(await Promise.all([start, entering, leaving]), [false, false, true]);
  assert.equal(audio.playCalls, 2);
  assert.deepEqual(manager.state(), { enabled: true, gestureReceived: true, filmActive: false, unavailable: false, playing: true });
  assert.equal(audio.volume, BGM_VOLUME);
});

test('re-enabling during startup supersedes the old play attempt', async () => {
  const audio = createFakeAudio();
  let firstPlay = true;
  audio.play = function play() {
    this.playCalls += 1;
    if (firstPlay) {
      firstPlay = false;
      return new Promise(() => {});
    }
    this.paused = false;
    return Promise.resolve();
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  const disabling = manager.toggle();
  const enabling = manager.toggle();
  assert.deepEqual(await Promise.all([start, disabling, enabling]), [false, false, true]);
  assert.equal(audio.playCalls, 2);
  assert.equal(audio.volume, BGM_VOLUME);
  assert.equal(manager.state().enabled, true);
});

test('an obsolete AbortError from play does not mark BGM unavailable', async () => {
  const audio = createFakeAudio();
  let rejectFirst;
  audio.play = function play() {
    this.playCalls += 1;
    if (this.playCalls === 1) return new Promise((_, reject) => { rejectFirst = reject; });
    this.paused = false;
    return Promise.resolve();
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  await manager.enterFilm();
  rejectFirst(new DOMException('cancelled', 'AbortError'));
  assert.equal(await start, false);
  assert.equal(await manager.leaveFilm(), true);
  assert.equal(audio.playCalls, 2);
  assert.equal(manager.state().unavailable, false);
});

test('destroy settles a start whose browser play promise never resolves', async () => {
  const audio = createFakeAudio({ playResult: new Promise(() => {}) });
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  manager.destroy();
  assert.equal(await start, false);
  assert.equal(audio.pauseCalls, 1);
});

test('a rejecting fade fails closed without an unhandled operation rejection', async () => {
  const audio = createFakeAudio();
  const manager = createAudioManager({
    audio,
    storage: createFakeStorage(),
    fade: async () => { throw new Error('fade failed'); },
  });

  assert.equal(await manager.startFromGesture(), false);
  assert.equal(manager.state().unavailable, true);
});

test('a late play success after destroy is immediately paused', async () => {
  const audio = createFakeAudio();
  let resolvePlay;
  audio.play = function play() {
    this.playCalls += 1;
    return new Promise((resolve) => {
      resolvePlay = () => { this.paused = false; resolve(); };
    });
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  manager.destroy();
  assert.equal(await start, false);
  resolvePlay();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(manager.state().playing, false);
  assert.equal(audio.pauseCalls, 2);
});

test('a late play success after disabling BGM is immediately paused', async () => {
  const audio = createFakeAudio();
  let resolvePlay;
  audio.play = function play() {
    this.playCalls += 1;
    return new Promise((resolve) => {
      resolvePlay = () => { this.paused = false; resolve(); };
    });
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  await manager.toggle();
  assert.equal(await start, false);
  resolvePlay();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(manager.state().playing, false);
  assert.equal(audio.pauseCalls, 2);
});

test('a late obsolete success does not pause newer valid playback', async () => {
  const audio = createFakeAudio();
  let resolveFirst;
  audio.play = function play() {
    this.playCalls += 1;
    if (this.playCalls === 1) {
      return new Promise((resolve) => {
        resolveFirst = () => { this.paused = false; resolve(); };
      });
    }
    this.paused = false;
    return Promise.resolve();
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  await manager.enterFilm();
  assert.equal(await manager.leaveFilm(), true);
  resolveFirst();
  await Promise.all([start, new Promise((resolve) => setImmediate(resolve))]);

  assert.equal(manager.state().playing, true);
  assert.equal(audio.pauseCalls, 1);
});

test('leaving film adopts already-playing BGM before an obsolete play fulfills', async () => {
  const audio = createFakeAudio();
  let resolvePlay;
  let resolveFilmFade;
  audio.play = function play() {
    this.playCalls += 1;
    this.paused = false;
    return new Promise((resolve) => { resolvePlay = resolve; });
  };
  const fade = async (_player, target) => {
    if (target === 0) await new Promise((resolve) => { resolveFilmFade = resolve; });
    audio.volume = target;
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  const start = manager.startFromGesture();
  const entering = manager.enterFilm();
  assert.equal(await manager.leaveFilm(), true);
  assert.equal(audio.paused, false);
  assert.equal(audio.volume, BGM_VOLUME);

  resolvePlay();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audio.paused, false);
  assert.equal(audio.volume, BGM_VOLUME);

  resolveFilmFade();
  await Promise.all([start, entering]);
});

test('leaving film while disabled keeps stale fades silent and paused', async () => {
  const audio = createFakeAudio();
  const { fade, pending } = createDeferredFade(audio);
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  const start = manager.startFromGesture();
  await new Promise((resolve) => setImmediate(resolve));
  pending.shift().resolve();
  await start;
  const entering = manager.enterFilm();
  const disabling = manager.toggle();
  assert.equal(await manager.leaveFilm(), false);
  pending.shift().resolve();
  pending.shift().resolve();
  await Promise.all([entering, disabling]);

  assert.deepEqual(manager.state(), { enabled: false, gestureReceived: true, filmActive: false, unavailable: false, playing: false });
  assert.equal(audio.volume, 0);
});

test('enabling BGM during film keeps stale fades silent and paused', async () => {
  const audio = createFakeAudio();
  const { fade, pending } = createDeferredFade(audio);
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade });

  const start = manager.startFromGesture();
  await new Promise((resolve) => setImmediate(resolve));
  pending.shift().resolve();
  await start;
  const entering = manager.enterFilm();
  const disabling = manager.toggle();
  assert.equal(await manager.toggle(), false);
  pending.shift().resolve();
  pending.shift().resolve();
  await Promise.all([entering, disabling]);

  assert.deepEqual(manager.state(), { enabled: true, gestureReceived: true, filmActive: true, unavailable: false, playing: false });
  assert.equal(audio.volume, 0);
});

test('an obsolete play success preserves a newer pending BGM attempt', async () => {
  const audio = createFakeAudio();
  let resolveFirst;
  let resolveSecond;
  audio.play = function play() {
    this.playCalls += 1;
    return new Promise((resolve) => {
      if (this.playCalls === 1) resolveFirst = () => { this.paused = false; resolve(); };
      else resolveSecond = () => { this.paused = false; resolve(); };
    });
  };
  const manager = createAudioManager({ audio, storage: createFakeStorage(), fade: immediateFade(audio) });

  const start = manager.startFromGesture();
  await manager.enterFilm();
  const leaving = manager.leaveFilm();
  resolveFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audio.pauseCalls, 1);
  assert.equal(manager.state().unavailable, false);

  resolveSecond();
  assert.equal(await leaving, true);
  assert.equal(await start, false);
  assert.deepEqual(manager.state(), { enabled: true, gestureReceived: true, filmActive: false, unavailable: false, playing: true });
  assert.equal(audio.volume, BGM_VOLUME);
});

test('storage read and write failures do not prevent BGM state transitions', async () => {
  const audio = createFakeAudio();
  const storage = {
    getItem() { throw new Error('storage read blocked'); },
    setItem() { throw new Error('storage write blocked'); },
  };
  const manager = createAudioManager({ audio, storage, fade: immediateFade(audio) });

  assert.equal(manager.state().enabled, true);
  assert.equal(await manager.startFromGesture(), true);
  assert.equal(await manager.toggle(), false);
  assert.equal(manager.state().enabled, false);
  assert.equal(await manager.toggle(), true);
  assert.equal(manager.state().enabled, true);
  assert.equal(audio.playCalls, 2);
});

test('a throwing global localStorage getter falls back to enabled BGM', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const audio = createFakeAudio();
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage access blocked'); },
    });
    const manager = createAudioManager({ audio, fade: immediateFade(audio) });
    assert.equal(manager.state().enabled, true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
