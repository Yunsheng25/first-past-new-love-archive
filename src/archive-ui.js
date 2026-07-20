import { mountArchiveTunnel } from './archive-tunnel.js';
import { mountArchiveCaseModal } from './archive-case-modal.js';

export const ARCHIVE_LAST_CASE_KEY = 'archive:lastCase';

const archiveDataCache = new WeakMap();

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function escapeArchiveHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function selectedValues(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [];
}

export function filterArchiveCases(cases, state = {}) {
  const query = String(state.query ?? '').trim().toLocaleLowerCase('zh-CN');
  const types = new Set(selectedValues(state.types));
  const stages = new Set(selectedValues(state.stages));
  return (Array.isArray(cases) ? cases : []).filter((item) => {
    if (types.size && !types.has(item.type)) return false;
    if (stages.size && !stages.has(item.stage)) return false;
    if (!query) return true;
    const searchable = [item.title, item.prompt, ...(item.tags ?? [])]
      .filter(Boolean)
      .join('\n')
      .toLocaleLowerCase('zh-CN');
    return searchable.includes(query);
  });
}

function shorten(value, length = 116) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '白板未提供提示词';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function uniqueInOrder(values) {
  return [...new Set(values.filter(Boolean))];
}

function checked(stateValues, value) {
  return selectedValues(stateValues).includes(value) ? ' checked' : '';
}

function filterButton(group, value, count, stateValues) {
  const safe = escapeArchiveHtml(value);
  return `<label class="archive-filter-chip">
    <input type="checkbox" value="${safe}" data-archive-${group}-filter="${safe}"${checked(stateValues, value)}>
    <span>${safe}<small>${count}</small></span>
  </label>`;
}

function allTypesButton(active, count) {
  return `<button type="button" class="archive-filter-chip archive-filter-all" data-archive-type-all aria-pressed="${active}"><span>全部<small>${count}</small></span></button>`;
}

function archiveCard(item) {
  const firstImage = item.images?.[0];
  const preview = firstImage
    ? `<img src="${escapeArchiveHtml(firstImage.src)}" alt="${escapeArchiveHtml(item.title)}案例预览" loading="lazy" decoding="async">`
    : `<span class="archive-card-placeholder" aria-label="白板未附图片"><b>${String(item.index).padStart(2, '0')}</b><small>NO IMAGE</small></span>`;
  return `<a class="archive-card" href="#archive/${encodeURIComponent(item.id)}" data-archive-card="${escapeArchiveHtml(item.id)}">
    <span class="archive-card-media">${preview}</span>
    <span class="archive-card-copy">
      <span class="archive-card-eyebrow"><b>${String(item.index).padStart(2, '0')}</b><i>${escapeArchiveHtml(item.type)}</i><i>${escapeArchiveHtml(item.stage)}</i></span>
      <strong>${escapeArchiveHtml(item.title)}</strong>
      <span>${escapeArchiveHtml(shorten(item.prompt))}</span>
      <small>${item.images?.length ?? 0} 张图片</small>
    </span>
  </a>`;
}

export function buildArchiveIndex(data, state = {}, lastCase = null) {
  const cases = Array.isArray(data?.cases) ? data.cases : [];
  const filtered = filterArchiveCases(cases, state);
  const types = data?.summary?.types?.length ? data.summary.types : uniqueInOrder(cases.map((item) => item.type));
  const stages = uniqueInOrder(cases.map((item) => item.stage));
  const typeCounts = data?.summary?.typeCounts ?? Object.fromEntries(types.map((type) => [type, cases.filter((item) => item.type === type).length]));
  const stageCounts = data?.summary?.stageCounts ?? Object.fromEntries(stages.map((stage) => [stage, cases.filter((item) => item.stage === stage).length]));
  const validLastCase = cases.some((item) => item.id === lastCase) ? lastCase : null;
  const resultMarkup = filtered.length
    ? filtered.map(archiveCard).join('\n')
    : `<div class="archive-empty" data-archive-empty><p>没有找到符合条件的案例</p><button type="button" data-clear-archive-filters>清除搜索与筛选</button></div>`;

  return `<section class="archive-index-view app-view" aria-labelledby="archive-index-title">
    <a class="archive-return-after" href="#after" data-return-after>← 返回片后</a>
    <header class="archive-header">
      <a class="archive-wordmark" href="#after">初恋 · 旧爱 · 新欢</a>
      <span>PROMPT & IMAGE ARCHIVE</span><button type="button" data-archive-view="tunnel">隧道模式</button>
    </header>
    <main class="archive-index-main">
      <section class="archive-index-sidebar">
        <p class="archive-kicker">MAKING ARCHIVE · ${cases.length} CASES</p>
        <h1 id="archive-index-title">提示词<br>和图片</h1>
        <p class="archive-counts"><b>${data?.summary?.cases ?? cases.length} 个案例</b><span>${data?.summary?.uniqueImages ?? 0} 张图片</span></p>
        ${validLastCase ? `<a class="archive-continue" data-continue-archive href="#archive/${encodeURIComponent(validLastCase)}">继续上次案例 · ${escapeArchiveHtml(validLastCase)}</a>` : ''}
        <label class="archive-search"><span>搜索标题、提示词或标签</span><input type="search" value="${escapeArchiveHtml(state.query ?? '')}" placeholder="输入关键词" data-archive-query></label>
        <fieldset class="archive-filter-group"><legend>生成类型</legend><div>${allTypesButton(selectedValues(state.types).length === 0, cases.length)}${types.map((type) => filterButton('type', type, typeCounts[type] ?? 0, state.types)).join('')}</div></fieldset>
        <fieldset class="archive-filter-group"><legend>场景阶段</legend><div>${stages.map((stage) => filterButton('stage', stage, stageCounts[stage] ?? 0, state.stages)).join('')}</div></fieldset>
      </section>
      <section class="archive-results" aria-label="案例总览">
        <div class="archive-results-meta"><span data-archive-result-count>${filtered.length} / ${cases.length} 个案例</span><button type="button" data-clear-archive-filters>重置筛选</button></div>
        <div class="archive-grid-scroll" tabindex="0"><div class="archive-grid">${resultMarkup}</div></div>
      </section>
    </main>
  </section>`;
}

export function buildArchiveIndexShell(summary = {}) {
  const total = Number(summary.imageOccurrences) || 138;
  return `<section class="archive-tunnel-view app-view" aria-label="提示词和图片总览">
    <header class="archive-tunnel-header">
      <a class="archive-wordmark" href="#after">初恋 · 旧爱 · 新欢</a>
      <div class="archive-tunnel-actions"><button type="button" data-archive-view="list">列表模式</button><button type="button" data-tunnel-cruise>暂停漫游</button></div>
    </header>
    <div class="archive-tunnel-stage" data-archive-tunnel aria-label="按制作顺序排列的图片隧道"></div>
    <div class="archive-tunnel-count"><b data-tunnel-current>001</b> / ${String(total).padStart(3, '0')}</div>
    <button type="button" class="archive-rewind" data-tunnel-rewind hidden>↶ 快速回溯</button>
    <div data-archive-modal-host></div>
    <a class="archive-return-after" href="#after" data-return-after>← 返回片后</a>
  </section>`;
}

export function resolveArchiveCase(data, id) {
  const cases = Array.isArray(data?.cases) ? data.cases : [];
  const index = cases.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return {
    item: cases[index],
    index,
    previous: index > 0 ? cases[index - 1] : null,
    next: index < cases.length - 1 ? cases[index + 1] : null,
  };
}

function archiveNavigation(item, attribute, label) {
  if (!item) return `<span class="archive-detail-nav-disabled" aria-disabled="true">${label}</span>`;
  return `<a href="#archive/${encodeURIComponent(item.id)}" ${attribute}>${label}</a>`;
}

function detailImageMarkup(image, index, title) {
  return `<figure class="archive-detail-image" data-archive-image-index="${index}" data-src="${escapeArchiveHtml(image.src)}">
    <button type="button" data-archive-lightbox-trigger data-archive-image-index="${index}" aria-label="放大查看：${escapeArchiveHtml(image.originalRef)}">
      <img src="${escapeArchiveHtml(image.src)}" alt="${escapeArchiveHtml(`${title} · ${image.role}`)}" loading="lazy" decoding="async">
    </button>
    <figcaption><span>${escapeArchiveHtml(image.role)}</span><span>${escapeArchiveHtml(image.originalRef)}</span><small>出现 ${image.occurrence}</small></figcaption>
  </figure>`;
}

function groupLabels(groups) {
  const labels = (groups ?? []).map((group) => group.label).filter(Boolean);
  return labels.length ? labels.join(' / ') : '无分组标记';
}

export function buildArchiveDetail(data, id) {
  const resolved = resolveArchiveCase(data, id);
  if (!resolved) {
    return `<section class="archive-status-view app-view" data-archive-missing><p>PROMPT & IMAGE ARCHIVE</p><h1>没有找到这个案例</h1><span>案例地址可能已经变化。</span><a href="#archive">返回全部案例</a><a href="#after">返回片后</a></section>`;
  }
  const { item, previous, next } = resolved;
  const images = item.images?.length
    ? item.images.map((image, index) => detailImageMarkup(image, index, item.title)).join('\n')
    : `<div class="archive-no-image"><p>白板未附图片</p><span>此案例只保留白板中的文字信息，不借用其他案例图片。</span></div>`;
  const prompt = String(item.prompt ?? '').trim();
  const promptMarkup = prompt
    ? `<p class="archive-prompt-text" data-archive-prompt tabindex="-1">${escapeArchiveHtml(prompt)}</p>`
    : `<p class="archive-prompt-empty" data-archive-prompt tabindex="-1">白板未提供提示词</p>`;
  const uncertain = item.uncertain
    ? `<aside class="archive-uncertain"><strong>原始数据标记</strong>${(item.uncertainReasons ?? []).map((reason) => `<p>${escapeArchiveHtml(reason)}</p>`).join('')}</aside>`
    : '';
  const lightboxImages = (item.images ?? []).map((image) => ({ src: image.src, alt: `${item.title} · ${image.role}` }));

  return `<section class="archive-detail-view app-view" aria-labelledby="archive-detail-title" data-archive-case="${escapeArchiveHtml(item.id)}">
    <a class="archive-return-after" href="#after" data-return-after>← 返回片后</a>
    <header class="archive-header archive-detail-header">
      <a class="archive-wordmark" href="#archive">初恋 · 旧爱 · 新欢</a>
      <a href="#archive" data-archive-all>全部案例</a>
      <span>${String(item.index).padStart(2, '0')} / ${String(data.cases.length).padStart(2, '0')}</span>
    </header>
    <main class="archive-detail-scroll" tabindex="0">
      <div class="archive-detail-layout">
        <section class="archive-detail-gallery" aria-label="案例图片">${images}</section>
        <article class="archive-detail-copy">
          <p class="archive-kicker">${escapeArchiveHtml(item.type)} · ${escapeArchiveHtml(item.stage)}</p>
          <h1 id="archive-detail-title">${escapeArchiveHtml(item.title)}</h1>
          <div class="archive-tags">${(item.tags ?? []).map((tag) => `<span>${escapeArchiveHtml(tag)}</span>`).join('')}</div>
          <dl class="archive-metadata">
            <div><dt>源节点</dt><dd>${escapeArchiveHtml(item.source?.nodeId)}</dd></div>
            <div><dt>白板坐标</dt><dd>x ${escapeArchiveHtml(item.source?.position?.x)} · y ${escapeArchiveHtml(item.source?.position?.y)}</dd></div>
            <div><dt>白板分组</dt><dd>${escapeArchiveHtml(groupLabels(item.source?.groups))}</dd></div>
          </dl>
          <div class="archive-prompt-heading"><h2>完整提示词</h2><button type="button" data-copy-prompt${prompt ? '' : ' disabled'}>复制提示词</button></div>
          <div class="archive-copy-status" data-copy-status aria-live="polite"></div>
          ${promptMarkup}
          ${uncertain}
        </article>
      </div>
    </main>
    <nav class="archive-detail-nav" aria-label="案例导航">
      ${archiveNavigation(previous, 'data-archive-prev', '← 上一个')}
      <a href="#archive" data-archive-all>返回全部</a>
      ${archiveNavigation(next, 'data-archive-next', '下一个 →')}
    </nav>
    <div class="archive-lightbox" data-archive-lightbox role="dialog" aria-modal="true" aria-label="案例图片预览" hidden data-images="${escapeArchiveHtml(JSON.stringify(lightboxImages))}">
      <button type="button" class="archive-lightbox-close" data-close-archive-lightbox aria-label="关闭图片预览">×</button>
      <button type="button" class="archive-lightbox-prev" data-archive-lightbox-prev aria-label="上一张图片">←</button>
      <img alt="">
      <button type="button" class="archive-lightbox-next" data-archive-lightbox-next aria-label="下一张图片">→</button>
      <span data-archive-lightbox-count aria-live="polite"></span>
    </div>
  </section>`;
}

export function readArchiveLastCase(storage = globalThis.localStorage, data = null) {
  try {
    const id = storage?.getItem(ARCHIVE_LAST_CASE_KEY);
    if (!/^case-\d{2}$/.test(id ?? '')) return null;
    if (data && !resolveArchiveCase(data, id)) return null;
    return id;
  } catch {
    return null;
  }
}

export function writeArchiveLastCase(storage = globalThis.localStorage, id) {
  try {
    if (!/^case-\d{2}$/.test(id ?? '')) return false;
    storage?.setItem(ARCHIVE_LAST_CASE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export async function copyArchivePrompt(prompt, {
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
} = {}) {
  try {
    if (typeof navigatorRef?.clipboard?.writeText === 'function') {
      await navigatorRef.clipboard.writeText(String(prompt));
      return true;
    }
  } catch {
    // Permission denial falls through to the synchronous accessibility fallback.
  }
  let textarea;
  let originalActive = null;
  let originalSelection = null;
  const originalRanges = [];
  try {
    if (typeof documentRef?.createElement !== 'function' || typeof documentRef?.execCommand !== 'function') return false;
    try { originalActive = documentRef.activeElement ?? null; } catch { originalActive = null; }
    try {
      originalSelection = documentRef.getSelection?.() ?? null;
      const rangeCount = Number(originalSelection?.rangeCount) || 0;
      for (let index = 0; index < rangeCount; index += 1) {
        const range = originalSelection.getRangeAt(index);
        originalRanges.push(typeof range?.cloneRange === 'function' ? range.cloneRange() : range);
      }
    } catch {
      originalSelection = null;
      originalRanges.length = 0;
    }
    textarea = documentRef.createElement('textarea');
    textarea.value = String(prompt);
    textarea.setAttribute?.('readonly', '');
    Object.assign(textarea.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
    documentRef.body?.append?.(textarea);
    textarea.select?.();
    return documentRef.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    try { textarea?.remove?.(); } catch { /* A detached fallback is already harmless. */ }
    if (originalSelection) {
      try { originalSelection.removeAllRanges?.(); } catch { /* Selection access can be blocked. */ }
      for (const range of originalRanges) {
        try { originalSelection.addRange?.(range); } catch { /* Restore as many original ranges as possible. */ }
      }
    }
    if (originalActive && originalActive.isConnected !== false) {
      try { originalActive.focus?.({ preventScroll: true }); } catch { /* Focus restoration is best effort. */ }
    }
  }
}

function selectVisibleArchivePrompt(root, documentRef) {
  try {
    const target = root.querySelector?.('[data-archive-prompt]');
    if (!target || typeof documentRef?.createRange !== 'function') return false;
    const selection = documentRef.getSelection?.() ?? globalThis.getSelection?.();
    if (!selection) return false;
    target.focus?.({ preventScroll: true });
    const range = documentRef.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function focusableElements(container) {
  return [...(container?.querySelectorAll?.(FOCUSABLE_SELECTOR) ?? [])]
    .filter((element) => !element.hidden && element.getAttribute?.('aria-hidden') !== 'true');
}

export function bindArchiveDetailInteractions(root, {
  images = null,
  prompt = '',
  documentRef = document,
  navigatorRef = globalThis.navigator,
  copyPrompt = copyArchivePrompt,
} = {}) {
  const lightbox = root.querySelector?.('[data-archive-lightbox]');
  const lightboxImage = lightbox?.querySelector?.('img');
  const lightboxClose = lightbox?.querySelector?.('[data-close-archive-lightbox]');
  const lightboxPrevious = lightbox?.querySelector?.('[data-archive-lightbox-prev]');
  const lightboxNext = lightbox?.querySelector?.('[data-archive-lightbox-next]');
  const lightboxCount = lightbox?.querySelector?.('[data-archive-lightbox-count]');
  const triggers = [...(root.querySelectorAll?.('[data-archive-lightbox-trigger]') ?? [])];
  let activeImages = images;
  if (!Array.isArray(activeImages)) {
    try { activeImages = JSON.parse(lightbox?.getAttribute?.('data-images') ?? '[]'); } catch { activeImages = []; }
  }
  let currentIndex = -1;
  let returnFocus = null;
  let active = true;
  let copyInFlight = false;

  const updateLightbox = () => {
    const item = activeImages[currentIndex];
    if (!item || !lightboxImage) return;
    lightboxImage.setAttribute?.('src', item.src);
    lightboxImage.setAttribute?.('alt', item.alt ?? '');
    if (lightboxCount) lightboxCount.textContent = `${currentIndex + 1} / ${activeImages.length}`;
    if (lightboxPrevious) lightboxPrevious.disabled = currentIndex <= 0;
    if (lightboxNext) lightboxNext.disabled = currentIndex >= activeImages.length - 1;
  };

  const openLightbox = (index, trigger) => {
    if (!lightbox || !activeImages[index]) return;
    currentIndex = index;
    returnFocus = trigger ?? documentRef.activeElement ?? null;
    lightbox.hidden = false;
    lightbox.setAttribute?.('aria-hidden', 'false');
    updateLightbox();
    lightboxClose?.focus?.({ preventScroll: true });
  };

  const closeLightbox = ({ restore = true } = {}) => {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightbox.setAttribute?.('aria-hidden', 'true');
    lightboxImage?.removeAttribute?.('src');
    const target = returnFocus;
    returnFocus = null;
    currentIndex = -1;
    if (restore && active) target?.focus?.({ preventScroll: true });
  };

  const moveLightbox = (delta) => {
    if (lightbox?.hidden || currentIndex < 0) return;
    const nextIndex = Math.max(0, Math.min(activeImages.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) return;
    currentIndex = nextIndex;
    updateLightbox();
  };

  const onClick = async (event) => {
    const closest = (selector) => event.target?.closest?.(selector);
    const trigger = closest('[data-archive-lightbox-trigger]');
    if (trigger) {
      const index = Number(trigger.getAttribute?.('data-archive-image-index'));
      openLightbox(index, trigger);
      return;
    }
    if (closest('[data-close-archive-lightbox]') || event.target === lightbox) {
      closeLightbox();
      return;
    }
    if (closest('[data-archive-lightbox-prev]')) { moveLightbox(-1); return; }
    if (closest('[data-archive-lightbox-next]')) { moveLightbox(1); return; }
    const copyButton = closest('[data-copy-prompt]');
    if (copyButton) {
      if (copyInFlight) return;
      const status = root.querySelector?.('[data-copy-status]');
      copyInFlight = true;
      copyButton.setAttribute?.('aria-disabled', 'true');
      copyButton.classList?.toggle?.('is-copying', true);
      if (status) status.textContent = '正在复制…';
      try {
        let success = false;
        try {
          success = await copyPrompt(prompt, { navigatorRef, documentRef });
        } catch {
          success = false;
        }
        if (!active) return;
        if (status) {
          if (success) {
            status.textContent = '提示词已复制';
          } else if (selectVisibleArchivePrompt(root, documentRef)) {
            status.textContent = '复制失败，已选中提示词，请手动复制';
          } else {
            status.textContent = '复制失败，请手动选择提示词';
          }
        }
      } finally {
        copyInFlight = false;
        copyButton.setAttribute?.('aria-disabled', 'false');
        copyButton.classList?.toggle?.('is-copying', false);
      }
    }
  };

  const onKeydown = (event) => {
    if (!lightbox || lightbox.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault?.();
      closeLightbox();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault?.();
      moveLightbox(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusableElements(lightbox);
    if (!elements.length) { event.preventDefault?.(); return; }
    const first = elements[0];
    const last = elements.at(-1);
    if ((event.shiftKey && documentRef.activeElement === first)
      || (!event.shiftKey && documentRef.activeElement === last)) {
      event.preventDefault?.();
      (event.shiftKey ? last : first).focus?.({ preventScroll: true });
    }
  };

  root.addEventListener?.('click', onClick);
  documentRef.addEventListener?.('keydown', onKeydown);
  return () => {
    active = false;
    root.removeEventListener?.('click', onClick);
    documentRef.removeEventListener?.('keydown', onKeydown);
    closeLightbox({ restore: false });
  };
}

export function bindArchiveIndexInteractions(root, data, state, render) {
  let composing = false;
  const applyQuery = (input) => {
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    state.query = input.value;
    render();
    const replacement = root.querySelector?.('[data-archive-query]');
    replacement?.focus?.({ preventScroll: true });
    if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
      replacement?.setSelectionRange?.(selectionStart, selectionEnd);
    }
  };
  const onInput = (event) => {
    if (!event.target?.matches?.('[data-archive-query]') || composing || event.isComposing) return;
    applyQuery(event.target);
  };
  const onCompositionStart = (event) => {
    if (!event.target?.matches?.('[data-archive-query]')) return;
    composing = true;
  };
  const onCompositionEnd = (event) => {
    if (!event.target?.matches?.('[data-archive-query]')) return;
    composing = false;
    applyQuery(event.target);
  };
  const onChange = (event) => {
    const type = event.target?.getAttribute?.('data-archive-type-filter');
    const stage = event.target?.getAttribute?.('data-archive-stage-filter');
    if (!type && !stage) return;
    const key = type ? 'types' : 'stages';
    const value = type || stage;
    const selected = new Set(state[key]);
    if (event.target.checked) selected.add(value); else selected.delete(value);
    state[key] = [...selected];
    render();
  };
  const onClick = (event) => {
    if (event.target?.closest?.('[data-archive-type-all]')) {
      state.types = [];
      render();
      return;
    }
    if (!event.target?.closest?.('[data-clear-archive-filters]')) return;
    state.query = '';
    state.types = [];
    state.stages = [];
    render();
  };
  root.addEventListener?.('input', onInput);
  root.addEventListener?.('compositionstart', onCompositionStart);
  root.addEventListener?.('compositionend', onCompositionEnd);
  root.addEventListener?.('change', onChange);
  root.addEventListener?.('click', onClick);
  return () => {
    root.removeEventListener?.('input', onInput);
    root.removeEventListener?.('compositionstart', onCompositionStart);
    root.removeEventListener?.('compositionend', onCompositionEnd);
    root.removeEventListener?.('change', onChange);
    root.removeEventListener?.('click', onClick);
  };
}

function loadingView() {
  return `<section class="archive-status-view app-view" data-archive-loading><p>PROMPT & IMAGE ARCHIVE</p><h1>正在打开制作档案</h1><span>请稍候…</span></section>`;
}

function errorView() {
  return `<section class="archive-status-view app-view" data-archive-error><p>PROMPT & IMAGE ARCHIVE</p><h1>制作档案暂时无法载入</h1><span>请检查连接后重试。</span><button type="button" data-retry-archive>重新载入</button><a href="#after">返回片后</a></section>`;
}

export function mountArchiveRoute(app, route, {
  fetchImpl = fetch,
  storage = globalThis.localStorage,
  documentRef = document,
  windowRef = window,
  navigatorRef = globalThis.navigator,
  mountTunnel = mountArchiveTunnel,
  mountCaseModal = mountArchiveCaseModal,
} = {}) {
  let active = true;
  let controller = null;
  let interactionCleanup = () => {};
  let retryButton = null;
  let retryHandler = null;

  const fetchArchive = async (request) => {
    if (archiveDataCache.has(fetchImpl)) return archiveDataCache.get(fetchImpl);
    const promise = Promise.resolve(fetchImpl('data/archive.json')).then(async (response) => {
      if (!response.ok) throw new Error(`Archive data request failed: ${response.status}`);
      return response.json();
    });
    archiveDataCache.set(fetchImpl, promise);
    try { return await promise; } catch (error) { archiveDataCache.delete(fetchImpl); throw error; }
  };

  const clearRetry = () => {
    retryButton?.removeEventListener?.('click', retryHandler);
    retryButton = null;
    retryHandler = null;
  };

  const load = async () => {
    interactionCleanup();
    interactionCleanup = () => {};
    clearRetry();
    controller?.abort();
    controller = new AbortController();
    const request = controller;
    app.innerHTML = loadingView();
    try {
      const data = await fetchArchive(request);
      if (!active || request.signal.aborted || request !== controller) return;

      if (route.name === 'archive-index') {
        const state = { query: '', types: [], stages: [] };
        let tunnel = null;
        let modal = null;
        let view = 'tunnel';
        let savedProgress = 0;
        const safeCall = (callback) => { try { return callback?.(); } catch { return undefined; } };
        const renderList = () => {
          if (!active) return;
          const snapshot = safeCall(() => tunnel?.snapshot?.());
          if (Number.isFinite(snapshot?.progress)) savedProgress = snapshot.progress;
          interactionCleanup();
          safeCall(() => modal?.destroy?.()); modal = null;
          safeCall(() => tunnel?.destroy?.()); tunnel = null;
          app.innerHTML = buildArchiveIndex(data, state, readArchiveLastCase(storage, data));
          view = 'list';
          const cleanupIndex = bindArchiveIndexInteractions(app, data, state, renderList);
          const switchView = (event) => { if (event.target?.closest?.('[data-archive-view="tunnel"]')) renderTunnel(); };
          app.addEventListener?.('click', switchView);
          interactionCleanup = () => { cleanupIndex(); app.removeEventListener?.('click', switchView); };
        };
        const renderTunnel = () => {
          if (!active) return;
          interactionCleanup();
          safeCall(() => modal?.destroy?.()); modal = null;
          safeCall(() => tunnel?.destroy?.()); tunnel = null;
          app.innerHTML = buildArchiveIndexShell(data.summary);
          view = 'tunnel';
          const stage = app.querySelector?.('[data-archive-tunnel]');
          const rewind = app.querySelector?.('[data-tunnel-rewind]');
          const cruise = app.querySelector?.('[data-tunnel-cruise]');
          const current = app.querySelector?.('[data-tunnel-current]');
          const modalHost = app.querySelector?.('[data-archive-modal-host]');
          let rewindActive = false;
          const mountedTunnel = mountTunnel(stage, data, {
            windowRef,
            initialProgress: savedProgress,
            onProgress(snapshot) {
              if (current) current.textContent = String(Math.round(snapshot.progress) + 1).padStart(3, '0');
              if (cruise) cruise.textContent = snapshot.mode === 'cruising' ? '暂停漫游' : '继续漫游';
              if (rewindActive && snapshot.mode === 'paused' && snapshot.progress <= 0.001) {
                rewindActive = false;
                if (rewind) { rewind.hidden = true; rewind.disabled = false; rewind.textContent = '↶ 快速回溯'; }
              }
            },
            onSelect(occurrence, trigger) {
              safeCall(() => tunnel?.pause?.());
              modal = safeCall(() => mountCaseModal(modalHost, { data, occurrence, trigger, documentRef, navigatorRef,
                onClose() { modal = null; safeCall(() => tunnel?.resume?.()); },
              }));
              if (!modal) safeCall(() => tunnel?.resume?.());
            },
            onEnd() { if (rewind) { rewind.hidden = false; rewind.disabled = false; rewind.textContent = '↶ 快速回溯'; } },
            onFallback() { if (active && view === 'tunnel') renderList(); },
          });
          if (view !== 'tunnel' || app.querySelector?.('[data-archive-tunnel]') !== stage) {
            safeCall(() => mountedTunnel?.destroy?.());
            return;
          }
          tunnel = mountedTunnel;
          const click = (event) => {
            if (event.target?.closest?.('[data-archive-view="list"]')) { renderList(); return; }
            if (event.target?.closest?.('[data-tunnel-cruise]')) {
              const snapshot = safeCall(() => tunnel?.snapshot?.());
              safeCall(() => snapshot?.mode === 'cruising' ? tunnel?.pause?.() : tunnel?.resume?.());
              return;
            }
            if (event.target?.closest?.('[data-tunnel-rewind]')) {
              if (safeCall(() => tunnel?.startRewind?.())) {
                rewindActive = true;
                if (rewind) { rewind.hidden = false; rewind.disabled = true; rewind.textContent = '正在回溯…'; }
              } else if (rewind) {
                rewind.hidden = false;
                rewind.disabled = false;
              }
            }
          };
          app.addEventListener?.('click', click);
          interactionCleanup = () => {
            app.removeEventListener?.('click', click);
            safeCall(() => modal?.destroy?.()); modal = null;
            safeCall(() => tunnel?.destroy?.()); tunnel = null;
          };
        };
        renderTunnel();
      } else {
        const resolved = resolveArchiveCase(data, route.id);
        app.innerHTML = buildArchiveDetail(data, route.id);
        if (resolved) {
          writeArchiveLastCase(storage, resolved.item.id);
          interactionCleanup = bindArchiveDetailInteractions(app, {
            images: resolved.item.images.map((image) => ({ src: image.src, alt: `${resolved.item.title} · ${image.role}` })),
            prompt: resolved.item.prompt,
            documentRef,
            navigatorRef,
          });
        }
      }
      app.focus?.({ preventScroll: true });
    } catch (error) {
      if (!active || request.signal.aborted || request !== controller) return;
      app.innerHTML = errorView();
      retryButton = app.querySelector?.('[data-retry-archive]');
      retryHandler = () => load();
      retryButton?.addEventListener?.('click', retryHandler);
      app.focus?.({ preventScroll: true });
    }
  };

  load();
  return () => {
    active = false;
    controller?.abort();
    clearRetry();
    interactionCleanup();
  };
}
