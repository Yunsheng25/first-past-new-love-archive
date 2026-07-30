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
import { mountGlobalParticles } from './src/global-particles.js';
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
bgmController.bind();

const preloaderUI = mountPreloaderUI(document, {
  assets: [],
  onRetry: () => void bootSite(),
  onSkip: () => void revealSite(),
});

function currentRoute() {
  if (window.location.hash === '#about') return { name: 'about' };
  return parseRoute(window.location.hash);
}

function mountRouteInteractions(...routeCleanups) {
  const particleCleanup = mountGlobalParticles(app);
  const cursorCleanup = mountAfterCursor(app, { cursor: sharedCursor });
  const cleanups = [particleCleanup, cursorCleanup, ...routeCleanups];
  return () => {
    [...cleanups].reverse().forEach((cleanup) => cleanup?.());
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
    const textCleanup = mountCharacterMotion(app);
    document.title = '初恋 · 旧爱 · 新欢｜电影制作档案';
    bindIntroMedia(app, {
      reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    });
    currentViewCleanup = mountRouteInteractions(textCleanup);
    focusRenderedView(app);
    return;
  }

  if (route.name === 'after') {
    app.innerHTML = buildAfterView();
    const textCleanup = mountCharacterMotion(app);
    document.title = '影片已结束｜初恋 · 旧爱 · 新欢';
    applyStoredLastFrame(app);
    const ambientCleanup = mountMindmapAmbient(app.querySelector('.after-view'), {
      count: 72,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    });
    currentViewCleanup = mountRouteInteractions(textCleanup, ambientCleanup);
    focusRenderedView(app);
    return;
  }

  if (route.name === 'review-index' || route.name === 'review-page') {
    document.title = route.name === 'review-index'
      ? '复盘手记｜初恋 · 旧爱 · 新欢'
      : '阅读复盘｜初恋 · 旧爱 · 新欢';
    currentViewCleanup = mountRouteInteractions(mountReviewRoute(app, route));
    focusRenderedView(app);
    return;
  }

  if (route.name === 'archive-index' || route.name === 'archive-detail') {
    document.title = route.name === 'archive-index'
      ? '提示词和图片｜初恋 · 旧爱 · 新欢'
      : '制作案例｜初恋 · 旧爱 · 新欢';
    currentViewCleanup = mountRouteInteractions(mountArchiveRoute(app, route));
    focusRenderedView(app);
    return;
  }

  app.innerHTML = buildPendingView(route.name);
  const textCleanup = mountCharacterMotion(app);
  document.title = '内容整理中｜初恋 · 旧爱 · 新欢';
  currentViewCleanup = mountRouteInteractions(textCleanup);
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

async function revealSite() {
  if (siteReady) return;
  siteReady = true;
  reviewTurnController.renderInitial(currentRoute());
  await preloaderUI.dismiss();
  preloaderUI.destroy();
}

async function bootSite() {
  if (siteReady) return;
  try {
    await revealSite();
  } catch (error) {
    preloaderUI.fail(error);
  }
}

void bootSite();
