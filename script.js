import { parseRoute } from './src/router.js';
import {
  applyStoredLastFrame,
  bindFilmCompletion,
  clearStoredLastFrame,
} from './src/after-film.js';
import { bindFilmMedia, bindIntroMedia, focusRenderedView } from './src/media-ui.js';
import { mountReviewRoute } from './src/review-reader.js';
import { buildAfterView, buildFilmView, buildIntroView, buildPendingView } from './src/views.js';

const app = document.querySelector('#app');
let ignoreNextFilmHashChange = false;
let currentViewCleanup = () => {};

function currentRoute() {
  if (window.location.hash === '#about') return { name: 'about' };
  return parseRoute(window.location.hash);
}

function renderRoute(route = currentRoute(), { playFilm = false } = {}) {
  currentViewCleanup();
  currentViewCleanup = () => {};

  if (route.name === 'film') {
    clearStoredLastFrame();
    app.innerHTML = buildFilmView();
    document.title = '观看完整成片｜初恋 · 旧爱 · 新欢';

    const film = app.querySelector('.film-video');
    film.muted = false;
    currentViewCleanup = bindFilmCompletion(app, {
      isCurrent: () => window.location.hash === '#film' && app.querySelector('.film-video') === film,
    });
    bindFilmMedia(app, { playImmediately: playFilm });
    focusRenderedView(app, { preferFilm: playFilm });
    return;
  }

  if (route.name === 'intro') {
    app.innerHTML = buildIntroView();
    document.title = '初恋 · 旧爱 · 新欢｜电影制作档案';
    bindIntroMedia(app, {
      reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    });
    focusRenderedView(app);
    return;
  }

  if (route.name === 'after') {
    app.innerHTML = buildAfterView();
    document.title = '影片已结束｜初恋 · 旧爱 · 新欢';
    applyStoredLastFrame(app);
    focusRenderedView(app);
    return;
  }

  if (route.name === 'review-index' || route.name === 'review-page') {
    document.title = route.name === 'review-index'
      ? '复盘手记｜初恋 · 旧爱 · 新欢'
      : '阅读复盘｜初恋 · 旧爱 · 新欢';
    currentViewCleanup = mountReviewRoute(app, route);
    focusRenderedView(app);
    return;
  }

  app.innerHTML = buildPendingView(route.name);
  document.title = '内容整理中｜初恋 · 旧爱 · 新欢';
  focusRenderedView(app);
}

document.addEventListener('click', (event) => {
  const playLink = event.target.closest('[data-play-film]');
  if (!playLink) return;

  if (playLink.matches('[data-replay-film]')) clearStoredLastFrame();
  event.preventDefault();
  ignoreNextFilmHashChange = window.location.hash !== '#film';
  window.location.hash = '#film';
  renderRoute({ name: 'film' }, { playFilm: true });
});

window.addEventListener('hashchange', () => {
  if (ignoreNextFilmHashChange && window.location.hash === '#film') {
    ignoreNextFilmHashChange = false;
    return;
  }
  ignoreNextFilmHashChange = false;
  renderRoute();
});

renderRoute();
