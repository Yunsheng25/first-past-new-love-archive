const CARD_COUNT = 28;
const IMAGE_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function developedCardCount(state, cardCount = CARD_COUNT) {
  const total = Math.max(0, Number(state?.totalFiles) || 0);
  const completed = Math.max(0, Number(state?.completedFiles) || 0);
  if (total === 0) return cardCount;
  return Math.min(cardCount, Math.round((completed / total) * cardCount));
}

export function preloadPhase(path = '') {
  if (path.includes('/review-media/')) return '正在整理 · 复盘案例';
  if (path.includes('/canvas-images/')) return '正在整理 · 图片与提示词';
  if (path.includes('/video/')) return path.includes('full-film')
    ? '正在整理 · 完整成片'
    : '正在整理 · 影像片段';
  if (path.includes('/audio/')) return '正在整理 · 项目配乐';
  return '正在装订 · 完整影像档案';
}

export function buildPreloaderMarkup(assets = []) {
  const images = assets.filter((asset) => IMAGE_PATTERN.test(asset.path));
  const cards = Array.from({ length: CARD_COUNT }, (_, index) => {
    const source = images[index % Math.max(1, images.length)]?.path ?? '';
    const style = source ? ` style="--preload-image:url(&quot;${escapeAttribute(source)}&quot;)"` : '';
    return `<i class="preload-card" data-preload-card data-frame="${String(index + 1).padStart(3, '0')}"${style}></i>`;
  }).join('');
  return `
    <div class="preload-grain" aria-hidden="true"></div>
    <div class="preload-ripple" aria-hidden="true"></div>
    <div class="preload-cursor" aria-hidden="true"></div>
    <header class="preload-header" aria-hidden="true">
      <span>初恋 · 旧爱 · 新欢</span><span>A FILM ARCHIVE · 2026</span>
    </header>
    <div class="preload-film" data-preload-film aria-hidden="true">${cards}</div>
    <div class="preload-center">
      <p class="preload-phase" data-preload-phase>正在装订 · 完整影像档案</p>
      <p class="preload-number"><strong data-preload-percent>0</strong><small>%</small></p>
      <div class="preload-track"><i data-preload-track></i><b aria-hidden="true"></b></div>
      <p class="preload-status" data-preload-status>正在准备全部项目素材</p>
      <p class="preload-meta"><span data-preload-bytes>0 MB / 0 MB</span><span data-preload-files>0 / 0</span></p>
      <button class="preload-retry" type="button" data-preload-retry hidden>重新加载缺失素材</button>
    </div>
    <p class="preload-hint" aria-hidden="true">移动鼠标 · 让影像在暗房中显现</p>
  `;
}

export function mountPreloaderUI(documentRef, { assets = [], onRetry = () => {} } = {}) {
  const root = documentRef.querySelector('#site-preloader');
  if (!root) throw new Error('Missing #site-preloader');
  root.innerHTML = buildPreloaderMarkup(assets);
  const cards = [...root.querySelectorAll('[data-preload-card]')];
  const retry = root.querySelector('[data-preload-retry]');
  let destroyed = false;

  function pointerMove(event) {
    if (destroyed) return;
    const x = event.clientX;
    const y = event.clientY;
    root.style.setProperty('--preload-pointer-x', `${x}px`);
    root.style.setProperty('--preload-pointer-y', `${y}px`);
    root.style.setProperty('--preload-parallax-x', `${(x / innerWidth - 0.5) * -28}px`);
    root.style.setProperty('--preload-parallax-y', `${(y / innerHeight - 0.5) * -18}px`);
    cards.forEach((card) => {
      const bounds = card.getBoundingClientRect();
      const distance = Math.hypot(x - (bounds.left + bounds.width / 2), y - (bounds.top + bounds.height / 2));
      card.classList.toggle('is-near-pointer', distance < 160);
    });
  }

  function update(state) {
    if (destroyed) return;
    root.querySelector('[data-preload-percent]').textContent = String(state.percent);
    root.querySelector('[data-preload-track]').style.width = `${state.percent}%`;
    root.querySelector('[data-preload-bytes]').textContent =
      `${formatBytes(state.loadedBytes)} / ${formatBytes(state.totalBytes)}`;
    root.querySelector('[data-preload-files]').textContent =
      `${state.completedFiles} / ${state.totalFiles}`;
    root.querySelector('[data-preload-phase]').textContent = preloadPhase(state.currentPath);
    const developed = developedCardCount(state, cards.length);
    cards.forEach((card, index) => card.classList.toggle('is-developed', index < developed));
  }

  function fail(error) {
    if (destroyed) return;
    root.classList.add('has-failed');
    root.querySelector('[data-preload-status]').textContent =
      `素材加载中断：${error?.assetPath?.split('/').at(-1) ?? '网络连接异常'}`;
    retry.hidden = false;
  }

  function retryClick() {
    root.classList.remove('has-failed');
    retry.hidden = true;
    root.querySelector('[data-preload-status]').textContent = '正在重新连接项目档案';
    onRetry();
  }

  function dismiss() {
    if (destroyed) return Promise.resolve();
    root.classList.add('is-leaving');
    return new Promise((resolve) => {
      const finish = () => {
        root.hidden = true;
        documentRef.body.classList.remove('site-is-preloading');
        resolve();
      };
      root.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 900);
    });
  }

  retry.addEventListener('click', retryClick);
  root.addEventListener('pointermove', pointerMove);
  return {
    update,
    fail,
    dismiss,
    destroy() {
      destroyed = true;
      retry.removeEventListener('click', retryClick);
      root.removeEventListener('pointermove', pointerMove);
    },
  };
}
