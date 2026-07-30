function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function routeLoadingWord(route = 'archive') {
  return route === 'review' ? '手记就绪' : '画面就绪';
}

function normalizedState({ route = 'archive', ready = 0, total = 0, failed = 0, stage } = {}) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeReady = Math.max(0, Math.min(safeTotal, Number(ready) || 0));
  const ratio = safeTotal === 0 ? 0 : safeReady / safeTotal;
  const safeStage = Number.isInteger(stage)
    ? Math.max(0, Math.min(3, stage))
    : ratio >= 1
      ? 3
      : safeReady > 0
        ? 2
        : 0;
  return {
    route,
    ready: safeReady,
    total: safeTotal,
    failed: Math.max(0, Number(failed) || 0),
    ratio,
    stage: safeStage,
  };
}

function paddedCount(value, total) {
  const width = Math.max(3, String(Math.max(0, total)).length);
  return String(Math.max(0, value)).padStart(width, '0');
}

export function buildRouteLoadingType(options = {}) {
  const state = normalizedState(options);
  const review = state.route === 'review';
  const word = routeLoadingWord(state.route);
  const awakeCount = Math.min(word.length, Math.floor(state.ratio * word.length));
  const stages = ['读取目录', '下载素材', '解码画面', '准备进入'];
  return `<section class="route-loading-type" data-route-loading-type data-${review ? 'review' : 'archive'}-loading data-route="${escapeHtml(state.route)}" aria-live="polite">
    <div class="route-loading-grid" aria-hidden="true"></div>
    <div class="route-loading-glow" aria-hidden="true"></div>
    <header><span>${review ? 'THE MAKING-OF NOTES' : 'PROMPT &amp; IMAGE ARCHIVE'}</span><span>初恋 · 旧爱 · 新欢</span></header>
    <div class="route-loading-center">
      <h1 aria-label="${word}">${[...word].map((character, index) =>
        `<span class="route-loading-character${index < awakeCount ? ' is-awake' : ''}" style="--character-index:${index}">${character}</span>`).join('')}</h1>
      <div class="route-loading-progress">
        <progress max="${Math.max(1, state.total)}" value="${state.ready}" data-route-loading-progress></progress>
        <strong data-route-loading-count>${paddedCount(state.ready, state.total)} / ${paddedCount(state.total, state.total)}</strong>
      </div>
      <ol data-route-loading-stages>${stages.map((label, index) =>
        `<li class="${index <= state.stage ? 'is-active' : ''}" data-route-loading-stage="${index}"><i></i><span>${label}</span></li>`).join('')}</ol>
      <p class="route-loading-error" data-route-loading-error${state.failed ? '' : ' hidden'}>${state.failed} 项画面暂未就绪</p>
      <div class="route-loading-actions">
        <button type="button" data-route-loading-retry${state.failed ? '' : ' hidden'}>重新加载失败项目</button>
        <a href="#after">返回选择</a>
      </div>
    </div>
  </section>`;
}

export function updateRouteLoadingType(root, options = {}) {
  const state = normalizedState(options);
  const word = routeLoadingWord(state.route);
  const awakeCount = Math.min(word.length, Math.floor(state.ratio * word.length));
  const progress = root?.querySelector?.('[data-route-loading-progress]');
  if (progress) {
    progress.max = Math.max(1, state.total);
    progress.value = state.ready;
  }
  const count = root?.querySelector?.('[data-route-loading-count]');
  if (count) {
    count.textContent = `${paddedCount(state.ready, state.total)} / ${paddedCount(state.total, state.total)}`;
  }
  root?.querySelectorAll?.('.route-loading-character').forEach((character, index) => {
    character.classList.toggle('is-awake', index < awakeCount);
  });
  root?.querySelectorAll?.('[data-route-loading-stage]').forEach((item) => {
    item.classList.toggle('is-active', Number(item.dataset.routeLoadingStage) <= state.stage);
  });
  const error = root?.querySelector?.('[data-route-loading-error]');
  if (error) {
    error.hidden = state.failed === 0;
    error.textContent = `${state.failed} 项画面暂未就绪`;
  }
  const retry = root?.querySelector?.('[data-route-loading-retry]');
  if (retry) retry.hidden = state.failed === 0;
  return state;
}

export function mountRouteLoadingType(root, {
  reducedMotion = false,
} = {}) {
  if (!root) return () => {};
  const onPointerMove = (event) => {
    if (reducedMotion) return;
    root.style.setProperty('--route-pointer-x', `${event.clientX}px`);
    root.style.setProperty('--route-pointer-y', `${event.clientY}px`);
  };
  root.addEventListener?.('pointermove', onPointerMove);
  return () => root.removeEventListener?.('pointermove', onPointerMove);
}
