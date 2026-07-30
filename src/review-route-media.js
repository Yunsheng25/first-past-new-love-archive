import { resolveReviewSpread } from './review-spread.js';
import { createRouteMediaLoader } from './route-media-loader.js';

function flattenBlocks(blocks = []) {
  return blocks.flatMap((block) => [
    block,
    ...flattenBlocks(block?.children ?? []),
  ]);
}

export function collectReviewSpreadMedia(data, chapterSlug, pageNumber) {
  const spread = resolveReviewSpread(data, chapterSlug, Number(pageNumber));
  if (!spread) return { images: [], videos: [], total: 0 };
  const blocks = [
    ...flattenBlocks(spread.left?.blocks ?? []),
    ...flattenBlocks(spread.right?.blocks ?? []),
  ];
  const images = [...new Set(
    blocks.filter((block) => block?.type === 'image' && block.src).map((block) => block.src),
  )];
  const videos = [...new Set(
    blocks.filter((block) => block?.type === 'video' && block.src).map((block) => block.src),
  )];
  return { images, videos, total: images.length + videos.length };
}

function abortError(signal) {
  return signal?.reason ?? new DOMException('Review media loading aborted', 'AbortError');
}

function wait(delay, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(abortError(signal));
    }, { once: true });
  });
}

function videoMetadata(src, createVideo, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  const video = createVideo();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener?.('loadedmetadata', onReady);
      video.removeEventListener?.('error', onError);
      signal.removeEventListener?.('abort', onAbort);
    };
    const onReady = () => { cleanup(); resolve(video); };
    const onError = () => { cleanup(); reject(new Error(`Video metadata failed to load: ${src}`)); };
    const onAbort = () => { cleanup(); reject(abortError(signal)); };
    video.preload = 'metadata';
    video.addEventListener?.('loadedmetadata', onReady, { once: true });
    video.addEventListener?.('error', onError, { once: true });
    signal.addEventListener?.('abort', onAbort, { once: true });
    video.src = src;
    video.load?.();
  });
}

export function createReviewRouteMediaLoader({
  createImageLoader = createRouteMediaLoader,
  createVideo = () => document.createElement('video'),
  onProgress = () => {},
  retries = 2,
} = {}) {
  const controller = new AbortController();
  const knownImages = new Set();
  const knownVideos = new Set();
  const readyVideos = new Set();
  const failedVideos = new Set();
  let imageState = { status: 'idle', ready: 0, failed: 0, total: 0 };
  let status = 'idle';

  const snapshot = () => Object.freeze({
    status,
    ready: imageState.ready + readyVideos.size,
    failed: imageState.failed + failedVideos.size,
    total: knownImages.size + knownVideos.size,
  });
  const report = () => {
    const state = snapshot();
    try { onProgress(state); } catch {}
    return state;
  };
  const imageLoader = createImageLoader({
    onProgress(next) {
      imageState = next;
      report();
    },
  });

  async function loadVideo(src) {
    if (readyVideos.has(src)) return;
    let error;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await videoMetadata(src, createVideo, controller.signal);
        readyVideos.add(src);
        failedVideos.delete(src);
        report();
        return;
      } catch (nextError) {
        if (controller.signal.aborted || nextError?.name === 'AbortError') throw abortError(controller.signal);
        error = nextError;
        if (attempt < retries) await wait(Math.min(600, 100 * (2 ** attempt)), controller.signal);
      }
    }
    failedVideos.add(src);
    report();
    return error;
  }

  async function run({ images = [], videos = [] }, retryOnly = false) {
    images.forEach((src) => knownImages.add(src));
    videos.forEach((src) => knownVideos.add(src));
    status = 'loading';
    report();
    const videoQueue = retryOnly ? [...failedVideos] : videos;
    const imagePromise = retryOnly ? imageLoader.retryFailed() : imageLoader.load(images);
    await Promise.all([
      imagePromise,
      Promise.all(videoQueue.map((src) => loadVideo(src))),
    ]);
    if (controller.signal.aborted) throw abortError(controller.signal);
    status = imageState.failed + failedVideos.size > 0 ? 'failed' : 'complete';
    return report();
  }

  return {
    load(resources) {
      return run(resources);
    },
    retryFailed() {
      return run({ images: [...knownImages], videos: [...failedVideos] }, true);
    },
    abort(reason) {
      imageLoader.abort?.(reason);
      if (!controller.signal.aborted) {
        controller.abort(reason ?? new DOMException('Review route changed', 'AbortError'));
      }
      status = 'aborted';
    },
    snapshot,
  };
}
