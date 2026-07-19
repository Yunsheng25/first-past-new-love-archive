import { filmEndedDestination } from './views.js';

export const LAST_FRAME_STORAGE_KEY = 'film:last-frame';
export const FILM_END_TRANSITION_MS = 950;
const invalidatedFrameStores = new WeakSet();

function availableStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function canTrackStorage(storage) {
  return storage !== null && (typeof storage === 'object' || typeof storage === 'function');
}

function invalidateFrameStore(storage) {
  if (canTrackStorage(storage)) invalidatedFrameStores.add(storage);
}

function validateFrameStore(storage) {
  if (canTrackStorage(storage)) invalidatedFrameStores.delete(storage);
}

function frameStoreIsInvalid(storage) {
  return canTrackStorage(storage) && invalidatedFrameStores.has(storage);
}

export function captureFilmFrame(video, { documentRef = globalThis.document, storage } = {}) {
  const frameStorage = availableStorage(storage);
  invalidateFrameStore(frameStorage);
  try {
    frameStorage?.removeItem(LAST_FRAME_STORAGE_KEY);
  } catch {
    // The in-memory invalidation above prevents a stale frame from being reused.
  }

  try {
    const width = Number(video?.videoWidth);
    const height = Number(video?.videoHeight);
    if (!documentRef || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return false;
    }

    const maxWidth = 1600;
    const scale = Math.min(1, maxWidth / width);
    const canvas = documentRef.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return false;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL('image/jpeg', 0.72);
    frameStorage?.setItem(LAST_FRAME_STORAGE_KEY, frame);
    validateFrameStore(frameStorage);
    return true;
  } catch {
    return false;
  }
}

export function bindFilmCompletion(
  root,
  {
    navigate = (destination) => { globalThis.location.hash = destination; },
    documentRef = globalThis.document,
    storage,
    matchMedia = (query) => globalThis.matchMedia?.(query),
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancelSchedule = (timerId) => globalThis.clearTimeout(timerId),
    isCurrent,
  } = {},
) {
  const video = root?.querySelector?.('.film-video');
  if (!video) return () => {};

  let completed = false;
  let navigated = false;
  let active = true;
  let timerId = null;
  const viewIsCurrent = isCurrent ?? (() => root?.querySelector?.('.film-video') === video);
  const finish = () => {
    if (!active || navigated) return;
    try {
      if (!viewIsCurrent()) return;
    } catch {
      return;
    }
    navigated = true;
    navigate(filmEndedDestination());
  };

  const handleEnded = () => {
    if (!active || completed) return;
    completed = true;
    captureFilmFrame(video, { documentRef, storage });

    try {
      root.querySelector?.('.film-view')?.classList?.add('is-ending');
    } catch {
      // The visual transition is optional; navigation must still complete.
    }

    let reduceMotion = false;
    try {
      reduceMotion = Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch {
      reduceMotion = false;
    }

    if (reduceMotion) {
      finish();
      return;
    }

    try {
      const scheduledTimer = schedule(() => {
        timerId = null;
        finish();
      }, FILM_END_TRANSITION_MS);
      if (!navigated) timerId = scheduledTimer;
    } catch {
      finish();
    }
  };
  video.addEventListener('ended', handleEnded, { once: true });

  return () => {
    if (!active) return;
    active = false;
    try {
      video.removeEventListener('ended', handleEnded);
    } catch {
      // The active guard still suppresses a queued event in limited media shims.
    }
    if (timerId !== null && timerId !== undefined) {
      try {
        cancelSchedule(timerId);
      } catch {
        // The active guard still makes a stale callback harmless.
      }
    }
    timerId = null;
  };
}

export function bindFilmExit(
  root,
  {
    documentRef = globalThis.document,
    navigate = (href) => { globalThis.location.hash = href; },
  } = {},
) {
  const video = root?.querySelector?.('.film-video');
  const exitControl = root?.querySelector?.('[data-exit-film]');
  if (!video || !exitControl) return () => {};

  let active = true;
  let exited = false;
  const exitFilm = () => {
    if (!active || exited) return;
    exited = true;
    try {
      video.pause?.();
    } catch {
      // Navigation should still release viewers when a media shim fails to pause.
    }
    try {
      navigate('#after');
    } catch {
      // A navigation failure should not surface as an uncaught input-event error.
      exited = false;
    }
  };
  const handleClick = (event) => {
    if (!active || exited) return;
    event?.preventDefault?.();
    exitFilm();
  };
  const handleKeydown = (event) => {
    if (event?.key !== 'Escape' || !active || exited) return;
    event?.preventDefault?.();
    exitFilm();
  };

  exitControl.addEventListener?.('click', handleClick);
  documentRef?.addEventListener?.('keydown', handleKeydown);

  return () => {
    if (!active) return;
    active = false;
    try {
      exitControl.removeEventListener?.('click', handleClick);
    } catch {
      // The active guard keeps stale listeners inert in limited DOM shims.
    }
    try {
      documentRef?.removeEventListener?.('keydown', handleKeydown);
    } catch {
      // The active guard keeps stale listeners inert in limited DOM shims.
    }
  };
}

function isStoredFrame(value) {
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=_-]+$/i.test(value ?? '');
}

export function applyStoredLastFrame(root, storage) {
  try {
    const frameStorage = availableStorage(storage);
    if (frameStoreIsInvalid(frameStorage)) return false;
    const frame = frameStorage?.getItem(LAST_FRAME_STORAGE_KEY);
    const backdrop = root?.querySelector?.('.after-backdrop');
    if (!backdrop || !isStoredFrame(frame)) return false;
    backdrop.style.backgroundImage = `url("${frame}")`;
    return true;
  } catch {
    return false;
  }
}

export function clearStoredLastFrame(storage) {
  const frameStorage = availableStorage(storage);
  invalidateFrameStore(frameStorage);
  try {
    frameStorage?.removeItem(LAST_FRAME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
