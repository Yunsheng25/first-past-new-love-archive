import { filmEndedDestination } from './views.js';

export const LAST_FRAME_STORAGE_KEY = 'film:last-frame';
export const FILM_END_TRANSITION_MS = 950;

function availableStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function captureFilmFrame(video, { documentRef = globalThis.document, storage } = {}) {
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
    availableStorage(storage)?.setItem(LAST_FRAME_STORAGE_KEY, frame);
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
  } = {},
) {
  const video = root?.querySelector?.('.film-video');
  if (!video) return false;

  let completed = false;
  let navigated = false;
  const finish = () => {
    if (navigated) return;
    navigated = true;
    navigate(filmEndedDestination());
  };

  video.addEventListener('ended', () => {
    if (completed) return;
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
      schedule(finish, FILM_END_TRANSITION_MS);
    } catch {
      finish();
    }
  }, { once: true });
  return true;
}

function isStoredFrame(value) {
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=_-]+$/i.test(value ?? '');
}

export function applyStoredLastFrame(root, storage) {
  try {
    const frame = availableStorage(storage)?.getItem(LAST_FRAME_STORAGE_KEY);
    const backdrop = root?.querySelector?.('.after-backdrop');
    if (!backdrop || !isStoredFrame(frame)) return false;
    backdrop.style.backgroundImage = `url("${frame}")`;
    return true;
  } catch {
    return false;
  }
}

export function clearStoredLastFrame(storage) {
  try {
    availableStorage(storage)?.removeItem(LAST_FRAME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
