export const REVIEW_READER_STATE_KEY = 'first-love-review-reader-v1';

function defaultReaderState() {
  return {
    theme: 'light',
    fontSize: 18,
    progress: null,
    annotations: [],
  };
}

export function readReaderState(storage = globalThis.localStorage) {
  if (!storage?.getItem) return defaultReaderState();
  try {
    const stored = JSON.parse(storage.getItem(REVIEW_READER_STATE_KEY) || '{}');
    return {
      ...defaultReaderState(),
      ...stored,
      annotations: Array.isArray(stored.annotations) ? stored.annotations : [],
    };
  } catch {
    return defaultReaderState();
  }
}

export function writeReaderState(storage = globalThis.localStorage, state) {
  try {
    storage?.setItem?.(REVIEW_READER_STATE_KEY, JSON.stringify(state));
  } catch {
    // Reading remains available when browser storage is unavailable.
  }
}

export function upsertAnnotation(state, annotation) {
  const annotations = [...(state?.annotations ?? [])];
  const existing = annotations.findIndex((item) => item.id === annotation.id);
  if (existing >= 0) annotations[existing] = annotation;
  else annotations.push(annotation);
  return { ...defaultReaderState(), ...state, annotations };
}

export function removeAnnotation(state, annotationId) {
  return {
    ...defaultReaderState(),
    ...state,
    annotations: (state?.annotations ?? []).filter((item) => item.id !== annotationId),
  };
}

export function createTextQuoteAnchor(text, start, end, { contextLength = 24 } = {}) {
  const source = String(text ?? '');
  const safeStart = Math.max(0, Math.min(source.length, Number(start) || 0));
  const safeEnd = Math.max(safeStart, Math.min(source.length, Number(end) || safeStart));
  const context = Math.max(0, Number(contextLength) || 0);
  return {
    quote: source.slice(safeStart, safeEnd),
    prefix: source.slice(Math.max(0, safeStart - context), safeStart),
    suffix: source.slice(safeEnd, Math.min(source.length, safeEnd + context)),
  };
}
