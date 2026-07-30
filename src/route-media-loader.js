function abortError(signal) {
  return signal?.reason ?? new DOMException('Route media loading aborted', 'AbortError');
}

function waitForAbort(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
  });
}

async function decodeImage(src, createImage, signal) {
  if (signal?.aborted) throw abortError(signal);
  const image = createImage();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Image failed to load: ${src}`));
  });
  image.src = src;
  await Promise.race([loaded, waitForAbort(signal)]);
  if (typeof image.decode === 'function') {
    await Promise.race([image.decode(), waitForAbort(signal)]);
  }
  if (signal?.aborted) throw abortError(signal);
  return image;
}

function defaultRetryDelay(attempt, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.min(720, 120 * (2 ** attempt)));
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(abortError(signal));
    }, { once: true });
  });
}

export function createRouteMediaLoader({
  createImage = () => new Image(),
  concurrency = 6,
  retries = 2,
  retryDelay = defaultRetryDelay,
  onProgress = () => {},
} = {}) {
  const readyUrls = new Set();
  const failedUrls = new Set();
  const knownUrls = new Set();
  let controller = new AbortController();
  let status = 'idle';

  const snapshot = () => Object.freeze({
    status,
    ready: [...knownUrls].filter((url) => readyUrls.has(url)).length,
    failed: [...knownUrls].filter((url) => failedUrls.has(url)).length,
    total: knownUrls.size,
    ratio: knownUrls.size === 0 ? 1 : [...knownUrls].filter((url) => readyUrls.has(url)).length / knownUrls.size,
    failedUrls: Object.freeze([...failedUrls]),
  });

  const report = () => {
    const state = snapshot();
    try { onProgress(state); } catch {}
    return state;
  };

  async function loadOne(url, signal) {
    if (readyUrls.has(url)) return;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (signal.aborted) throw abortError(signal);
      try {
        await decodeImage(url, createImage, signal);
        if (signal.aborted) throw abortError(signal);
        readyUrls.add(url);
        failedUrls.delete(url);
        report();
        return;
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') throw abortError(signal);
        lastError = error;
        if (attempt < retries) await retryDelay(attempt, signal);
      }
    }
    failedUrls.add(url);
    report();
    return lastError;
  }

  async function load(urls = []) {
    if (controller.signal.aborted) throw abortError(controller.signal);
    const uniqueUrls = [...new Set(urls.map(String).filter(Boolean))];
    uniqueUrls.forEach((url) => knownUrls.add(url));
    const queue = uniqueUrls.filter((url) => !readyUrls.has(url));
    let nextIndex = 0;
    status = 'loading';
    report();

    async function worker() {
      while (nextIndex < queue.length) {
        const index = nextIndex;
        nextIndex += 1;
        await loadOne(queue[index], controller.signal);
      }
    }

    const workerCount = Math.min(
      queue.length,
      Math.max(1, Math.floor(concurrency) || 1),
    );
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (controller.signal.aborted) throw abortError(controller.signal);
    status = failedUrls.size > 0 ? 'failed' : 'complete';
    return report();
  }

  return {
    load,
    retryFailed() {
      return load([...failedUrls]);
    },
    abort(reason) {
      if (!controller.signal.aborted) {
        controller.abort(reason ?? new DOMException('Route changed', 'AbortError'));
      }
      status = 'aborted';
    },
    snapshot,
    readyUrls,
    failedUrls,
  };
}
