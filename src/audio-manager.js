export const BGM_PREFERENCE_KEY = 'bgm:enabled';
export const BGM_VOLUME = 0.14;

export function createVolumeFade({ schedule = setTimeout, cancel = clearTimeout, now = Date.now } = {}) {
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
    const startedAt = now();
    const step = () => {
      const progress = Math.min(1, (now() - startedAt) / total);
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
  let preferenceStore = storage;
  if (preferenceStore === undefined) {
    try {
      preferenceStore = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      preferenceStore = null;
    }
  }
  const volumeFade = fade ?? createVolumeFade();
  let enabled = true;
  try {
    enabled = preferenceStore?.getItem(BGM_PREFERENCE_KEY) !== 'false';
  } catch {
    enabled = true;
  }
  let gestureReceived = false;
  let filmActive = false;
  let unavailable = !player;
  let destroyed = false;
  let transition = 0;
  let playAttempt = null;
  let targetVolume = 0;
  let playbackOwnerVersion = null;

  if (player) {
    player.loop = true;
    player.volume = 0;
  }

  const isPlaying = () => Boolean(player && !player.paused);
  const pause = () => { player?.pause(); };
  const canResume = () => Boolean(
    player && enabled && gestureReceived && !filmActive && !unavailable && !destroyed,
  );

  const cancelPlayAttempt = () => {
    playAttempt?.cancel();
  };

  const beginTransition = (target) => {
    transition += 1;
    targetVolume = target;
    if (target === 0) playbackOwnerVersion = null;
    volumeFade.cancel?.();
    cancelPlayAttempt();
    return transition;
  };

  const fadeTo = async (target, duration) => {
    if (!player) return false;
    const currentTransition = beginTransition(target);
    try {
      await volumeFade(player, target, duration);
    } catch {
      if (currentTransition === transition && !destroyed) {
        unavailable = true;
        pause();
      }
      return false;
    }
    const completed = !destroyed && currentTransition === transition;
    if (!completed && !destroyed) player.volume = targetVolume;
    return completed;
  };

  const resume = ({ forceFade = false } = {}) => {
    if (!canResume()) return false;
    if (playAttempt?.version === transition) return playAttempt.promise;
    cancelPlayAttempt();
    if (isPlaying()) {
      if (!forceFade) {
        playbackOwnerVersion = transition;
        return true;
      }
      const fading = fadeTo(BGM_VOLUME, 280);
      playbackOwnerVersion = transition;
      return fading.then((completed) => (
        completed && !destroyed && !filmActive && enabled && !unavailable
      ));
    }

    const version = transition;
    let cancel;
    const cancelled = new Promise((resolve) => { cancel = () => resolve({ cancelled: true }); });
    let browserPlay;
    let attempt;
    try {
      browserPlay = Promise.resolve(player.play()).then(
        () => ({ played: true }),
        () => ({ failed: true }),
      );
    } catch {
      browserPlay = Promise.resolve({ failed: true });
    }
    attempt = {
      version,
      cancel,
      promise: null,
    };
    browserPlay.then(
      (result) => {
        if (!result.played || attempt === playAttempt && version === transition) return;
        const newerPlaybackOwnsPlayer = playbackOwnerVersion === transition
          && enabled && gestureReceived && !filmActive && !unavailable && !destroyed;
        const newerAttemptProvisionallyOwnsPlayer = playAttempt
          && playAttempt !== attempt
          && playAttempt.version === transition
          && canResume();
        if (!newerPlaybackOwnsPlayer && !newerAttemptProvisionallyOwnsPlayer) pause();
      },
      () => {},
    );
    const operation = (async () => {
      const result = await Promise.race([browserPlay, cancelled]);
      if (result.cancelled || destroyed || version !== transition) return false;
      if (result.failed) {
        unavailable = true;
        pause();
        return false;
      }
      if (destroyed || filmActive || !enabled) {
        pause();
        return false;
      }
      if (playAttempt === attempt) playAttempt = null;
      const fading = fadeTo(BGM_VOLUME, 280);
      playbackOwnerVersion = transition;
      const completed = await fading;
      return completed && !destroyed && !filmActive && enabled && !unavailable;
    })().catch(() => {
      if (!destroyed && version === transition) {
        unavailable = true;
        pause();
      }
      return false;
    });
    attempt.promise = operation;
    playAttempt = attempt;
    operation.then(
      () => { if (playAttempt === attempt) playAttempt = null; },
      () => { if (playAttempt === attempt) playAttempt = null; },
    );
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
      if (!canResume()) {
        beginTransition(0);
        pause();
        return false;
      }
      beginTransition(BGM_VOLUME);
      return resume({ forceFade: true });
    },
    async toggle() {
      if (destroyed) return false;
      enabled = !enabled;
      try {
        preferenceStore?.setItem(BGM_PREFERENCE_KEY, String(enabled));
      } catch {
        // Playback state remains authoritative when browser storage is unavailable.
      }
      if (!enabled) {
        const completed = await fadeTo(0, 280);
        if (completed) pause();
        return false;
      }
      if (!canResume()) {
        beginTransition(0);
        pause();
        return false;
      }
      beginTransition(BGM_VOLUME);
      return resume({ forceFade: true });
    },
    state() {
      return { enabled, gestureReceived, filmActive, unavailable, playing: isPlaying() };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      transition += 1;
      cancelPlayAttempt();
      volumeFade.cancel?.();
      pause();
    },
  };
}
