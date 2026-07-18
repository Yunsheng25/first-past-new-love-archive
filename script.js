import { parseRoute } from './src/router.js';
import { buildFilmView, buildIntroView, buildPendingView } from './src/views.js';

const app = document.querySelector('#app');
let ignoreNextFilmHashChange = false;

function currentRoute() {
  if (window.location.hash === '#about') return { name: 'about' };
  return parseRoute(window.location.hash);
}

function renderRoute(route = currentRoute(), { playFilm = false } = {}) {
  if (route.name === 'film') {
    app.innerHTML = buildFilmView();
    document.title = '观看完整成片｜初恋 · 旧爱 · 新欢';

    const film = app.querySelector('.film-video');
    film.muted = false;
    film.addEventListener('ended', () => {
      // The post-film transition is intentionally owned by the next implementation task.
    });
    if (playFilm) film.play().catch(() => {});
    film.focus({ preventScroll: true });
    return;
  }

  if (route.name === 'intro') {
    app.innerHTML = buildIntroView();
    document.title = '初恋 · 旧爱 · 新欢｜电影制作档案';
    const backgroundFilm = app.querySelector('.intro-film');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      backgroundFilm.pause();
    } else {
      backgroundFilm.play().catch(() => {});
    }
    return;
  }

  app.innerHTML = buildPendingView(route.name);
  document.title = '内容整理中｜初恋 · 旧爱 · 新欢';
}

document.addEventListener('click', (event) => {
  const playLink = event.target.closest('[data-play-film]');
  if (!playLink) return;

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
