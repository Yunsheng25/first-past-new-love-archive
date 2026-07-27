import { parseRoute } from './src/router.js';
import {
  applyStoredLastFrame,
  bindFilmCompletion,
  bindFilmExit,
  bindFilmFullscreen,
  clearStoredLastFrame,
} from './src/after-film.js';
import { mountAfterCursor } from './src/after-cursor.js';
import { bindFilmMedia, bindIntroMedia, focusRenderedView } from './src/media-ui.js';
import { mountArchiveRoute } from './src/archive-ui.js';
import { mountReviewRoute, peekReviewData } from './src/review-reader.js';
import { createReviewTurnController } from './src/review-turn.js';
import { buildAfterView, buildFilmView, buildIntroView, buildPendingView } from './src/views.js';
import { createAudioManager } from './src/audio-manager.js';
import { createBgmController } from './src/bgm-ui.js';
import { mountCharacterMotion } from './src/text-motion.js';
import { mountMindmapAmbient } from './src/mindmap-ambient.js';
import { PRELOAD_ASSETS } from './preload-manifest.js';
import { preloadAssets } from './src/site-preloader.js';
import { mountPreloaderUI } from './src/preloader-ui.js';

const app = document.querySelector('#app');
const bgmToggle = document.querySelector('[data-bgm-toggle]');
const sharedCursor = document.createElement('span');
sharedCursor.className = 'after-cursor';
sharedCursor.dataset.afterCursor = '';
sharedCursor.setAttribute('aria-hidden', 'true');
document.body.append(sharedCursor);
const audioManager = createAudioManager();
const bgmController = createBgmController({ document, button: bgmToggle, manager: audioManager });
let ignoreNextFilmHashChange = false;
let currentViewCleanup = () => {};
let siteReady = false;
let preloadAttempt = null;
bgmController.bind();

const preloaderUI = mountPreloaderUI(document, {
  assets: PRELOAD_ASSETS,
  onRetry: () => void bootSite(),
});

function currentRoute() {
  if (window.location.hash === '#about') return { name: 'about' };
  return parseRoute(window.location.hash);
}

function mountPostFilmCursor(routeCleanup = () => {}) {
  const cursorCleanup = mountAfterCursor(app, { cursor: sharedCursor });
  return () => {
    cursorCleanup();
    routeCleanup();
  };
}

function renderRoute(route = currentRoute(), { playFilm = false } = {}) {
  currentViewCleanup();
  currentViewCleanup = () => {};
  void bgmController.setRoute(route);

  if (route.name === 'film') {
    clearStoredLastFrame();
    app.innerHTML = buildFilmView();
    document.title = '观看完整成片｜初恋 · 旧爱 · 新欢';

    const film = app.querySelector('.film-video');
    film.muted = false;
    const completionCleanup = bindFilmCompletion(app, {
      isCurrent: () => window.location.hash === '#film' && app.querySelector('.film-video') === film,
    });
    const exitCleanup = bindFilmExit(app);
    const fullscreenCleanup = bindFilmFullscreen(app);
    currentViewCleanup = () => {
      completionCleanup();
      exitCleanup();
      fullscreenCleanup();
    };
    bindFilmMedia(app, { playImmediately: playFilm });
    focusRenderedView(app, { preferFilm: playFilm });
    return;
  }

  if (route.name === 'intro') {
    app.innerHTML = buildIntroView();
    mountCharacterMotion(app);
    document.title = '初恋 · 旧爱 · 新欢｜电影制作档案';
    bindIntroMedia(app, {
      reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    });
    currentViewCleanup = mountPostFilmCursor();
    focusRenderedView(app);
    return;
  }

  if (route.name === 'after') {
    app.innerHTML = buildAfterView();
    mountCharacterMotion(app);
    document.title = '影片已结束｜初恋 · 旧爱 · 新欢';
    applyStoredLastFrame(app);
    const ambientCleanup = mountMindmapAmbient(app.querySelector('.after-view'), {
      count: 72,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    });
    currentViewCleanup = mountPostFilmCursor(ambientCleanup);
    focusRenderedView(app);
    return;
  }

  if (route.name === 'review-index' || route.name === 'review-page') {
    document.title = route.name === 'review-index'
      ? '复盘手记｜初恋 · 旧爱 · 新欢'
      : '阅读复盘｜初恋 · 旧爱 · 新欢';
    currentViewCleanup = mountPostFilmCursor(mountReviewRoute(app, route));
    focusRenderedView(app);
    return;
  }

  if (route.name === 'archive-index' || route.name === 'archive-detail') {
    document.title = route.name === 'archive-index'
      ? '提示词和图片｜初恋 · 旧爱 · 新欢'
      : '制作案例｜初恋 · 旧爱 · 新欢';
    currentViewCleanup = mountPostFilmCursor(mountArchiveRoute(app, route));
    focusRenderedView(app);
    return;
  }

  app.innerHTML = buildPendingView(route.name);
  mountCharacterMotion(app);
  document.title = '内容整理中｜初恋 · 旧爱 · 新欢';
  focusRenderedView(app);
}

const reviewTurnController = createReviewTurnController({
  documentRef: document,
  windowRef: window,
  getRoute: currentRoute,
  renderRoute,
  peekReviewData: () => peekReviewData(globalThis.fetch),
  reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
});

document.addEventListener('click', (event) => {
  if (!siteReady) return;
  reviewTurnController.recordIntent(event);
  const playLink = event.target.closest('[data-play-film]');
  if (!playLink) return;

  if (playLink.matches('[data-replay-film]')) clearStoredLastFrame();
  event.preventDefault();
  ignoreNextFilmHashChange = window.location.hash !== '#film';
  window.location.hash = '#film';
  renderRoute({ name: 'film' }, { playFilm: true });
});

window.addEventListener('hashchange', () => {
  if (!siteReady) return;
  if (ignoreNextFilmHashChange && window.location.hash === '#film') {
    ignoreNextFilmHashChange = false;
    return;
  }
  ignoreNextFilmHashChange = false;
  reviewTurnController.handleHashChange();
});

function runFullSitePreload() {
  if (preloadAttempt) return preloadAttempt;
  preloadAttempt = preloadAssets({
    assets: PRELOAD_ASSETS,
    concurrency: 4,
    retries: 2,
    onProgress: preloaderUI.update,
  }).finally(() => {
    preloadAttempt = null;
  });
  return preloadAttempt;
}

async function bootSite() {
  if (siteReady) return;
  try {
    await runFullSitePreload();
    if (siteReady) return;
    siteReady = true;
    reviewTurnController.renderInitial(currentRoute());
    await preloaderUI.dismiss();
    preloaderUI.destroy();
  } catch (error) {
    preloaderUI.fail(error);
  }
}

void bootSite();
