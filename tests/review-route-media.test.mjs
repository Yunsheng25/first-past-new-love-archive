import test from 'node:test';
import assert from 'node:assert/strict';

import reviewData from '../data/review.json' with { type: 'json' };
import {
  collectReviewSpreadMedia,
  createReviewRouteMediaLoader,
} from '../src/review-route-media.js';

test('review preparation follows the actual facing-page spread and keeps media order', () => {
  const media = collectReviewSpreadMedia(reviewData, 'production', 10);

  assert.deepEqual(media.images, []);
  assert.deepEqual(media.videos, [
    'assets/review-media/011-“戴”戒指.mp4',
    'assets/review-media/012-“弹”钢琴.mp4',
  ]);
  assert.equal(media.total, 2);
});

test('review preparation does not report ready until image decode and video metadata finish', async () => {
  const videoNodes = [];
  const progress = [];
  let imageProgress;
  const loader = createReviewRouteMediaLoader({
    createImageLoader({ onProgress }) {
      imageProgress = onProgress;
      return {
        async load(urls) {
          onProgress({ status: 'loading', ready: 0, failed: 0, total: urls.length });
          await Promise.resolve();
          onProgress({ status: 'complete', ready: urls.length, failed: 0, total: urls.length });
          return { status: 'complete', ready: urls.length, failed: 0, total: urls.length };
        },
        async retryFailed() {
          return { status: 'complete', ready: 1, failed: 0, total: 1 };
        },
        abort() {},
      };
    },
    createVideo() {
      const listeners = new Map();
      const video = {
        preload: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
        load() {},
        set src(value) { this.currentSrc = value; videoNodes.push({ video: this, listeners }); },
      };
      return video;
    },
    onProgress(snapshot) { progress.push(snapshot); },
  });

  let settled = false;
  const pending = loader.load({
    images: ['image.webp'],
    videos: ['video.mp4'],
  }).then((result) => { settled = true; return result; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(progress.at(-1).ready, 1);
  assert.equal(imageProgress instanceof Function, true);

  videoNodes[0].listeners.get('loadedmetadata')();
  const result = await pending;
  assert.equal(settled, true);
  assert.deepEqual(
    { status: result.status, ready: result.ready, failed: result.failed, total: result.total },
    { status: 'complete', ready: 2, failed: 0, total: 2 },
  );
});
