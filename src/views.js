const navItems = [
  ['#film', '观看成片'],
  ['#archive', '制作档案'],
  ['#review', '复盘手记'],
  ['#about', '关于项目'],
];

function buildIntroNavigation() {
  return navItems
    .map(([href, label]) => `<a href="${href}">${label}<i aria-hidden="true"></i></a>`)
    .join('');
}

export function buildIntroView() {
  return `
    <section class="intro-view app-view" aria-labelledby="intro-title">
      <video
        class="intro-film"
        src="assets/video/intro-background.mp4"
        autoplay
        muted
        loop
        playsinline
        preload="auto"
        aria-hidden="true"
      ></video>
      <div class="intro-shade" aria-hidden="true"></div>
      <div class="media-status intro-media-status" role="status" aria-live="polite" hidden>
        <span data-intro-media-message>背景影片未能自动播放</span>
        <button type="button" data-retry-intro>播放背景</button>
      </div>

      <header class="intro-header">
        <a class="wordmark" href="#" aria-label="返回片头">初恋 · 旧爱 · 新欢<i aria-hidden="true"></i></a>
        <nav class="intro-nav" aria-label="主要导航">${buildIntroNavigation()}</nav>
        <p class="archive-mark">A FILM ARCHIVE · 2026</p>
      </header>

      <div class="intro-hero">
        <p class="hero-eyebrow">MEMORY <span aria-hidden="true">·</span> CHOICE <span aria-hidden="true">·</span> AFTERWARDS</p>
        <h1 id="intro-title" class="hero-title">
          <span>初恋</span><b aria-hidden="true">·</b><span>旧爱</span><b aria-hidden="true">·</b><span>新欢</span>
        </h1>
        <div class="title-translation" aria-label="First love, past love, new love">
          <span>FIRST LOVE</span><span>PAST LOVE</span><span>NEW LOVE</span>
        </div>
        <p class="hero-statement"><i aria-hidden="true"></i>每一段情感，都是时光里的一次遇见<i aria-hidden="true"></i></p>
        <p class="hero-translation">Like the first time, like the reunion, like what comes after.</p>
        <a href="#film" class="watch-film" data-play-film>
          <span class="play-disc" aria-hidden="true"><i></i></span>
          <span>观看完整成片<small>WATCH THE FILM</small></span>
        </a>
      </div>

      <footer class="intro-footer" aria-hidden="true">
        <span>BACKGROUND FILM · 64% OPACITY</span>
        <span>4× SPEED · MUTED · LOOP</span>
      </footer>
    </section>`;
}

export function buildFilmView() {
  return `
    <section class="film-view app-view" aria-label="完整成片播放器">
      <video
        class="film-video"
        src="assets/video/full-film.mp4"
        controls
        playsinline
        preload="metadata"
      ></video>
      <div class="media-status film-media-status" role="status" aria-live="polite" hidden>
        <span data-film-media-message>影片加载失败</span>
        <button type="button" data-retry-film>重新播放</button>
      </div>
      <a href="#" class="film-back"><span aria-hidden="true">←</span> 返回片头</a>
      <p class="film-caption">《初恋 · 旧爱 · 新欢》<span>A FILM ARCHIVE · 2026</span></p>
    </section>`;
}

const pendingLabels = {
  'archive-index': '制作档案',
  'review-index': '复盘手记',
  about: '关于项目',
};

export function buildPendingView(routeName = '') {
  const label = pendingLabels[routeName] ?? '此内容';
  return `
    <section class="pending-view app-view" aria-labelledby="pending-title">
      <p>A FILM ARCHIVE · 2026</p>
      <h1 id="pending-title">${label}</h1>
      <p>${label}将在后续阶段接入，这里暂不展示虚构内容。</p>
      <a href="#">返回片头</a>
    </section>`;
}

export function filmEndedDestination() {
  return null;
}
