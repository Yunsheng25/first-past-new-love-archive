export const BGM_PREFERENCE_KEY = 'bgm:enabled';
export const BGM_VOLUME = 0.14;

export function createVolumeFade({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  let active = null;

  const stopActive = () => {
    if (!active) return;
    if (active.timer !== null) cancel(active.timer);
    active.settle();
  };

  const fade = (audio, target, duration = 300) => new Promise((resolve) => {
    stopActive();

    const start = Number(audio.volume) || 0;
    const total = Number(duration) || 0;
    if (total <= 0 || start === target) {
      audio.volume = target;
      resolve();
      return;
    }

    const run = {
      timer: null,
      settled: false,
      settle() {
        if (this.settled) return;
        this.settled = true;
        if (active === this) active = null;
        resolve();
      },
    };
    active = run;
    const startedAt = Date.now();
    const step = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / total);
      audio.volume = start + ((target - start) * progress);
      if (progress === 1) {
        run.settle();
        return;
      }
      run.timer = schedule(step, Math.min(16, total));
    };

    step();
  });

  fade.cancel = () => {
    stopActive();
  };

  return fade;
}

export function createAudioManager({ audio, storage, fade } = {}) {
  const player = audio ?? (typeof Audio === 'function' ? new Audio('assets/audio/memory-piano.wav') : null);
  const preferenceStore = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const volumeFade = fade ?? createVolumeFade();
  let enabled = preferenceStore?.getItem(BGM_PREFERENCE_KEY) !== 'false';
  let gestureReceived = false;
  let filmActive = false;
  let unavailable = !player;
  let destroyed = false;
  let transition = 0;
  let resumePromise = null;

  if (player) {
    player.loop = true;
    player.volume = 0;
  }

  const isPlaying = () => Boolean(player && !player.paused);
  const pause = () => { player?.pause(); };

  const fadeTo = async (target, duration) => {
    if (!player) return false;
    const currentTransition = ++transition;
    await volumeFade(player, target, duration);
    return !destroyed && currentTransition === transition;
  };

  const resume = () => {
    if (destroyed || !enabled || !gestureReceived || filmActive || unavailable || !player) return false;
    if (resumePromise) return resumePromise;
    if (isPlaying()) return true;

    const operation = (async () => {
      try {
        await player.play();
      } catch {
        unavailable = true;
        pause();
        return false;
      }
      if (destroyed || filmActive || !enabled) {
        pause();
        return false;
      }
      const completed = await fadeTo(BGM_VOLUME, 280);
      return completed && !destroyed && !filmActive && enabled && !unavailable;
    })();
    resumePromise = operation;
    operation.finally(() => {
      if (resumePromise === operation) resumePromise = null;
    });
    return operation;
  };

  return {
    async startFromGesture() {
      if (destroyed) return false;
      gestureReceived = true;
      return resume();
    },
    async enterFilm() {
      if (destroyed) return false;
      filmActive = true;
      const completed = await fadeTo(0, 360);
      if (completed) pause();
      return completed;
    },
    async leaveFilm() {
      if (destroyed) return false;
      filmActive = false;
      transition += 1;
      return resume();
    },
    async toggle() {
      if (destroyed) return false;
      enabled = !enabled;
      preferenceStore?.setItem(BGM_PREFERENCE_KEY, String(enabled));
      if (!enabled) {
        const completed = await fadeTo(0, 280);
        if (completed) pause();
        return false;
      }
      return resume();
    },
    state() {
      return { enabled, gestureReceived, filmActive, unavailable, playing: isPlaying() };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      transition += 1;
      volumeFade.cancel?.();
      pause();
    },
  };
}
