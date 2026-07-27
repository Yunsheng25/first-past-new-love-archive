function abortError(signal) {
  return signal?.reason ?? new DOMException('Preloading aborted', 'AbortError');
}

function assetError(path, error) {
  const wrapped = new Error(`Failed to preload ${path}: ${error?.message ?? error}`);
  wrapped.cause = error;
  wrapped.assetPath = path;
  return wrapped;
}

export function selectCriticalAssets(assets = [], routeName = 'intro') {
  const target = routeName === 'film'
    ? 'assets/video/full-film.mp4'
    : routeName === 'intro'
      ? 'assets/video/intro-background.mp4'
      : '';
  return target ? assets.filter((asset) => asset.path === target) : [];
}

export async function preloadInBackground({
  assets = [],
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  try {
    await preloadAssets({
      assets,
      fetchImpl,
      signal,
      concurrency: 2,
      retries: 0,
    });
    return Object.freeze({ status: 'complete', failedPath: '' });
  } catch (error) {
    return Object.freeze({
      status: signal?.aborted ? 'aborted' : 'partial',
      failedPath: error?.assetPath ?? '',
    });
  }
}

export async function preloadAssets({
  assets = [],
  fetchImpl = globalThis.fetch,
  concurrency = 4,
  retries = 2,
  signal,
  onProgress = () => {},
} = {}) {
  const queue = Array.isArray(assets) ? assets.map((asset) => ({
    path: String(asset?.path ?? ''),
    bytes: Math.max(0, Number(asset?.bytes) || 0),
  })) : [];
  const totalBytes = queue.reduce((sum, asset) => sum + asset.bytes, 0);
  const loadedByPath = new Map();
  let completedFiles = 0;
  let nextIndex = 0;

  function snapshot(status, currentPath = '') {
    const loadedBytes = Math.min(
      totalBytes,
      [...loadedByPath.values()].reduce((sum, bytes) => sum + bytes, 0),
    );
    const state = Object.freeze({
      status,
      completedFiles,
      totalFiles: queue.length,
      loadedBytes,
      totalBytes,
      percent: totalBytes === 0 ? 100 : Math.min(100, Math.floor((loadedBytes / totalBytes) * 100)),
      currentPath,
    });
    try {
      onProgress(state);
    } catch {
      // Consumer errors must never interrupt network loading.
    }
    return state;
  }

  async function consume(response, asset) {
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
    let received = 0;
    const reader = response.body?.getReader?.();
    if (reader) {
      while (true) {
        if (signal?.aborted) throw abortError(signal);
        const { done, value } = await reader.read();
        if (done) break;
        received += value?.byteLength ?? 0;
        loadedByPath.set(asset.path, Math.max(
          loadedByPath.get(asset.path) ?? 0,
          Math.min(asset.bytes, received),
        ));
        snapshot('loading', asset.path);
      }
    } else {
      received = (await response.arrayBuffer()).byteLength;
    }
    loadedByPath.set(asset.path, Math.max(
      loadedByPath.get(asset.path) ?? 0,
      Math.min(asset.bytes, Math.max(received, asset.bytes)),
    ));
  }

  async function loadOne(asset) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (signal?.aborted) throw abortError(signal);
      try {
        const response = await fetchImpl(asset.path, { cache: 'force-cache', signal });
        await consume(response, asset);
        completedFiles += 1;
        snapshot('loading', asset.path);
        return;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal);
        lastError = error;
        if (attempt === retries) throw assetError(asset.path, lastError);
      }
    }
  }

  async function worker() {
    while (true) {
      if (signal?.aborted) throw abortError(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= queue.length) return;
      await loadOne(queue[index]);
    }
  }

  snapshot('loading');
  const workers = Array.from(
    { length: Math.min(queue.length, Math.max(1, Math.floor(concurrency) || 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return snapshot('complete');
}
