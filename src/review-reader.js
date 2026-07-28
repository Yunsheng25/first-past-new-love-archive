import { buildReviewRail, reviewRailMarkup } from './review-rail.js';
import { mountReviewRail } from './review-rail-interaction.js';
import { resolveReviewMap } from './review-live-map-model.js';
import { mountReviewLiveMaps } from './review-live-map.js';

export const REVIEW_PROGRESS_KEY = 'review:progress';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderInlineMarkdown(value = '') {
  const codeTokens = [];
  const tokenPrefix = `REVIEWCODE${Math.random().toString(36).slice(2)}`;
  let safe = String(value).replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `${tokenPrefix}${codeTokens.length}TOKEN`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  safe = escapeHtml(safe)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');

  codeTokens.forEach((markup, index) => {
    safe = safe.replace(`${tokenPrefix}${index}TOKEN`, markup);
  });
  return safe;
}

function pageHref(chapter, page) {
  return `#review/${encodeURIComponent(chapter)}/${page}`;
}

export function normalizeReviewTarget(data, chapterSlug, requestedPage = 1) {
  const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
  const chapterIndex = chapters.findIndex((chapter) => chapter.slug === chapterSlug);
  if (chapterIndex < 0) return null;

  const chapter = chapters[chapterIndex];
  const pageCount = Array.isArray(chapter.pages) ? chapter.pages.length : 0;
  if (pageCount === 0) return null;
  const numericPage = Number(requestedPage);
  const validPage = Number.isInteger(numericPage) ? numericPage : 1;
  const page = Math.min(pageCount, Math.max(1, validPage));
  const pageIndex = page - 1;
  const totalPages = chapters.reduce((sum, item) => sum + item.pages.length, 0);
  const completedPages = chapters
    .slice(0, chapterIndex)
    .reduce((sum, item) => sum + item.pages.length, 0);

  let previousHref = null;
  if (pageIndex > 0) {
    previousHref = pageHref(chapter.slug, pageIndex);
  } else if (chapterIndex > 0) {
    const previousChapter = chapters[chapterIndex - 1];
    previousHref = pageHref(previousChapter.slug, previousChapter.pages.length);
  }

  let nextHref = null;
  if (page < pageCount) {
    nextHref = pageHref(chapter.slug, page + 1);
  } else if (chapterIndex < chapters.length - 1) {
    nextHref = pageHref(chapters[chapterIndex + 1].slug, 1);
  }

  return {
    chapter,
    chapterIndex,
    page,
    pageIndex,
    pageCount,
    overallPage: completedPages + page,
    totalPages,
    previousHref,
    nextHref,
  };
}

function flattenReviewBlocks(blocks = []) {
  return blocks.flatMap((block) => [block, ...flattenReviewBlocks(block.children)]);
}

export function estimateReadingMinutes(chapter) {
  const characterCount = flattenReviewBlocks(chapter.pages.flat())
    .filter((block) => block.type === 'text' || block.type === 'heading')
    .reduce((sum, block) => sum + (String(block.text).match(/[\u3400-\u9fff]/g)?.length ?? 0), 0);
  return Math.max(1, Math.ceil(characterCount / 400));
}

function summaryFor(chapter) {
  const fallback = flattenReviewBlocks(chapter.pages?.flat()).find((block) => block.type === 'text')?.text ?? '';
  const summary = String(chapter.summary || fallback)
    .replace(/^\[!NOTE\]\s*/, '')
    .replace(/[*`]/g, '')
    .trim();
  return summary.length > 96 ? `${summary.slice(0, 96)}……` : summary;
}

function validProgressTarget(data, progress) {
  if (!progress || typeof progress.chapter !== 'string') return null;
  if (!Number.isInteger(progress.page) || progress.page < 1) return null;
  const target = normalizeReviewTarget(data, progress.chapter, progress.page);
  return target && target.page === progress.page ? target : null;
}

function chapterDirectory(data, activeSlug = '') {
  return data.chapters.map((chapter, index) => {
    const active = chapter.slug === activeSlug;
    return `
      <a class="review-chapter-link${active ? ' is-current' : ''}" href="${pageHref(chapter.slug, 1)}"${active ? ' aria-current="page"' : ''}>
        <span>${String(index + 1).padStart(2, '0')}</span>
        <strong>${escapeHtml(chapter.title)}</strong>
        <small>${chapter.pages.length} 页</small>
      </a>`;
  }).join('');
}

export function buildReviewIndex(data, progress = null) {
  const continuation = validProgressTarget(data, progress);
  const totalPages = data.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);
  const cards = data.chapters.map((chapter, index) => `
    <a class="review-index-card" href="${pageHref(chapter.slug, 1)}" data-review-chapter="${escapeHtml(chapter.slug)}">
      <span class="review-index-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="review-index-card-copy">
        <strong data-review-chapter-title>${escapeHtml(chapter.title)}</strong>
        <span>${escapeHtml(summaryFor(chapter))}</span>
      </span>
      <small data-reading-time="${estimateReadingMinutes(chapter)}">约${estimateReadingMinutes(chapter)}分钟 · ${chapter.pages.length} 页</small>
    </a>`).join('');

  return `
    <section class="review-index-view app-view" aria-labelledby="review-index-title">
      <a class="review-return-after" href="#after" data-return-after>← 返回片后</a>
      <header class="review-index-header">
        <a class="review-wordmark" href="#">初恋 · 旧爱 · 新欢</a>
        <span>A FILM ARCHIVE · REVIEW NOTES</span>
      </header>
      <main class="review-index-main">
        <div class="review-index-intro">
          <p>REVIEW NOTES · ${data.chapters.length} CHAPTERS · ${totalPages} PAGES</p>
          <h1 id="review-index-title">复盘手记</h1>
          <p>从创作缘起到最后回望，按原手记结构逐页阅读。文中的图片与视频案例均保留在原来的叙述位置。</p>
          <div class="review-index-actions">
            <a href="${pageHref(data.chapters[0].slug, 1)}" data-start-review>从头阅读</a>
            ${continuation ? `<a href="${pageHref(continuation.chapter.slug, continuation.page)}" data-continue-review>继续阅读 · ${escapeHtml(continuation.chapter.title)} / ${continuation.page}</a>` : ''}
          </div>
        </div>
        <nav class="review-index-list" aria-label="复盘章节">${cards}</nav>
      </main>
    </section>`;
}

function blockMarkup(block, blockIndex, chapterSlug, page, { sectionTitle = false } = {}) {
  const occurrence = `${chapterSlug}-p${page}-b${blockIndex}`;
  const safeBlockIndex = escapeHtml(blockIndex);
  const common = `data-block-type="${escapeHtml(block.type)}" data-block-index="${safeBlockIndex}"`;

  if (block.type === 'callout') {
    const oversized = block.oversized || block.scrollable;
    const classes = `review-block review-callout${oversized ? ' is-oversized' : ''}`;
    const originalTitle = block.title || block.kind || '说明';
    const calloutTitleId = escapeHtml(`review-callout-title-${encodeURIComponent(chapterSlug)}-p${page}-b${blockIndex}`);
    const bodyAccessibility = oversized
      ? ` tabindex="0" role="region" aria-labelledby="${calloutTitleId}"`
      : '';
    const contextHeading = block.contextHeading?.text
      ? `<p class="review-callout-context">${renderInlineMarkdown(block.contextHeading.text)}</p>`
      : '';
    const children = (Array.isArray(block.children) ? block.children : [])
      .map((child, childIndex) => blockMarkup(
        child,
        `${blockIndex}-${childIndex}`,
        chapterSlug,
        page,
      ))
      .join('\n');
    return `<aside class="${classes}" ${common}${block.scrollable ? ' data-scrollable="true"' : ''}>
      <header class="review-callout-header">
        <span class="review-callout-label">批注</span>
        <strong class="review-callout-title" id="${calloutTitleId}">${escapeHtml(originalTitle)}</strong>
      </header>
      ${contextHeading}
      <div class="review-callout-body"${bodyAccessibility}>${children}</div>
    </aside>`;
  }

  if (block.type === 'heading') {
    const level = Math.min(5, Math.max(3, Number(block.level) || 3));
    const sectionTitleId = sectionTitle ? ' id="review-section-title"' : '';
    return `<h${level} class="review-block review-heading" ${common}${sectionTitleId}>${renderInlineMarkdown(block.text)}</h${level}>`;
  }

  if (block.type === 'image') {
    const source = escapeHtml(block.src);
    const alt = escapeHtml(block.ref || block.rawRef || '复盘案例图片');
    const liveMap = resolveReviewMap(block.ref || block.rawRef);
    if (liveMap) {
      return `<figure class="review-block review-media review-image review-map-summary" ${common} data-source="${source}" data-occurrence="${occurrence}">
        <button type="button" class="review-map-cover" data-review-live-map="${escapeHtml(liveMap.id)}" aria-label="进入${escapeHtml(liveMap.title)}交互拆解">
          <img src="${source}" alt="${alt}" loading="lazy" decoding="async" data-lightbox-image data-occurrence="${occurrence}">
          <span><b>进入交互拆解</b><small>拖动 · 缩放 · 逐层展开</small></span>
        </button>
      </figure>`;
    }
    return `<figure class="review-block review-media review-image" ${common} data-source="${source}" data-occurrence="${occurrence}">
      <button type="button" class="review-image-button" data-lightbox-trigger data-lightbox-src="${source}" data-lightbox-alt="${alt}" aria-label="放大查看：${alt}">
        <img src="${source}" alt="${alt}" loading="lazy" decoding="async" data-lightbox-image data-occurrence="${occurrence}">
      </button>
    </figure>`;
  }

  if (block.type === 'video') {
    const source = escapeHtml(block.src);
    const label = escapeHtml(block.ref || block.rawRef || '复盘案例视频');
    return `<figure class="review-block review-media review-video" ${common} data-source="${source}" data-occurrence="${occurrence}">
      <video class="review-media-video" src="${source}" controls preload="metadata" playsinline aria-label="案例视频：${label}" data-occurrence="${occurrence}"></video>
    </figure>`;
  }

  const note = String(block.text ?? '').match(/^\[!NOTE\]\s*(.*)$/s);
  if (note) {
    return `<aside class="review-block review-note" ${common}><span>注</span><p>${renderInlineMarkdown(note[1])}</p></aside>`;
  }
  return `<p class="review-block review-paragraph" ${common}>${renderInlineMarkdown(block.text)}</p>`;
}

function navigationLink(href, direction, label) {
  if (!href) return `<span class="review-page-nav-disabled">${label}</span>`;
  const attribute = direction === 'previous' ? 'data-review-prev' : 'data-review-next';
  return `<a href="${href}" ${attribute} data-review-direction="${direction}">${label}</a>`;
}

export function buildReviewPage(data, target) {
  const { chapter, pageIndex } = target;
  const chapterIndex = Number.isInteger(target.chapterIndex)
    ? target.chapterIndex
    : data.chapters.indexOf(chapter);
  const normalized = normalizeReviewTarget(data, chapter.slug, pageIndex + 1);
  const blocks = chapter.pages[pageIndex];
  const section = blocks.find((block) => block.section)?.section || chapter.title;
  const isChapterOpener = pageIndex === 0;
  const firstHeadingIndex = !isChapterOpener && blocks[0]?.type === 'heading' ? 0 : -1;
  const hasSectionTitle = firstHeadingIndex >= 0;
  const readerLabel = `复盘阅读：${chapter.title} · ${section}`;
  const articleLabel = hasSectionTitle ? 'aria-labelledby="review-section-title"' : `aria-label="${escapeHtml(readerLabel)}"`;
  const renderedBlocks = blocks
    .map((block, blockIndex) => blockMarkup(block, blockIndex, chapter.slug, pageIndex + 1, {
      sectionTitle: blockIndex === firstHeadingIndex,
    }))
    .join('\n');

  return `
    <section class="review-reader-view app-view" ${isChapterOpener ? 'aria-labelledby="review-reader-title"' : `aria-label="${escapeHtml(readerLabel)}"`}>
      <a class="review-return-after" href="#after" data-return-after>← 返回片后</a>
      <header class="review-reader-header">
        <a class="review-wordmark" href="#">初恋 · 旧爱 · 新欢</a>
        <button type="button" class="review-drawer-toggle" data-toggle-review-drawer aria-expanded="false" aria-controls="review-chapter-drawer">章节目录</button>
        <span>REVIEW NOTES · ${String(chapterIndex + 1).padStart(2, '0')}</span>
      </header>
      <div class="review-reader-layout">
        ${reviewRailMarkup(buildReviewRail(data, { ...target, chapter, pageIndex }))}
        <aside class="review-chapter-sidebar" aria-label="复盘章节">
          <div class="review-chapter-drawer-title"><span>章节目录</span></div>
          <nav>${chapterDirectory(data, chapter.slug)}</nav>
        </aside>
        <main class="review-paper" aria-live="polite">
          <div class="review-paper-meta">
            <span>第 ${chapterIndex + 1} 章</span>
            <span>${escapeHtml(section)}</span>
            <span>全篇 ${normalized.overallPage} / ${normalized.totalPages} · 本章 ${pageIndex + 1} / ${chapter.pages.length}</span>
          </div>
          <div class="review-paper-scroll" data-review-scroll tabindex="0">
            <article class="review-paper-content${isChapterOpener ? ' review-chapter-opener' : ''}" data-review-page="${isChapterOpener ? 'opener' : 'continuation'}" ${articleLabel}>
              ${isChapterOpener ? `<p class="review-paper-kicker">CHAPTER ${String(chapterIndex + 1).padStart(2, '0')}</p>
              <h1 id="review-reader-title">${escapeHtml(chapter.title)}</h1>` : ''}
              <div class="review-blocks"${hasSectionTitle ? ' aria-labelledby="review-section-title"' : ''}>${renderedBlocks}</div>
            </article>
          </div>
          <nav class="review-page-nav" aria-label="分页阅读">
            ${navigationLink(normalized.previousHref, 'previous', '← 上一页')}
            <a href="#review" class="review-page-directory">目录</a>
            ${navigationLink(normalized.nextHref, 'next', '下一页 →')}
          </nav>
        </main>
      </div>
      <aside id="review-chapter-drawer" class="review-chapter-drawer" data-review-drawer role="dialog" aria-modal="true" aria-label="移动端复盘章节" aria-hidden="true" hidden>
        <div class="review-chapter-drawer-title"><span>章节目录</span><button type="button" data-close-review-drawer aria-label="关闭章节目录">×</button></div>
        <nav>${chapterDirectory(data, chapter.slug)}</nav>
      </aside>
      <div class="review-lightbox" data-review-lightbox role="dialog" aria-modal="true" aria-label="案例图片预览" hidden>
        <button type="button" class="review-lightbox-close" data-close-lightbox aria-label="关闭图片预览">×</button>
        <img alt="">
      </div>
    </section>`;
}

export function readReviewProgress(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(REVIEW_PROGRESS_KEY) ?? 'null');
    if (!value || typeof value.chapter !== 'string' || !Number.isInteger(value.page) || value.page < 1) return null;
    if (!Object.hasOwn(value, 'updatedAt')) return null;
    return { chapter: value.chapter, page: value.page, updatedAt: value.updatedAt };
  } catch {
    return null;
  }
}

export function writeReviewProgress(storage = globalThis.localStorage, target, now = new Date()) {
  try {
    const updatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    storage?.setItem(REVIEW_PROGRESS_KEY, JSON.stringify({
      chapter: target.chapter,
      page: target.page,
      updatedAt,
    }));
    return true;
  } catch {
    return false;
  }
}

function navigateTo(windowRef, href) {
  if (href) windowRef.location.hash = href.replace(/^#/, '');
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function createFocusTrap(container, { documentRef = document } = {}) {
  let active = false;
  let returnFocus = null;

  const focusableElements = () => [...(container?.querySelectorAll?.(FOCUSABLE_SELECTOR) ?? [])]
    .filter((element) => !element.hidden && element.getAttribute?.('aria-hidden') !== 'true');

  return {
    activate({ initialFocus = null, returnFocus: nextReturnFocus = null } = {}) {
      active = true;
      returnFocus = nextReturnFocus ?? documentRef.activeElement ?? null;
      const target = initialFocus ?? focusableElements()[0];
      target?.focus?.({ preventScroll: true });
    },
    deactivate({ restoreFocus = true } = {}) {
      if (!active) return;
      active = false;
      const target = returnFocus;
      returnFocus = null;
      if (restoreFocus) target?.focus?.({ preventScroll: true });
    },
    handleKeydown(event) {
      if (!active || event.key !== 'Tab') return false;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault?.();
        return true;
      }

      const first = elements[0];
      const last = elements.at(-1);
      const currentIndex = elements.indexOf(documentRef.activeElement);
      if (elements.length === 1
        || (event.shiftKey && (documentRef.activeElement === first || currentIndex < 0))
        || (!event.shiftKey && (documentRef.activeElement === last || currentIndex < 0))) {
        event.preventDefault?.();
        (event.shiftKey ? last : first).focus?.({ preventScroll: true });
      }
      return true;
    },
    isActive() {
      return active;
    },
  };
}

export function bindReviewInteractions(root, {
  documentRef = document,
  windowRef = window,
} = {}) {
  const drawer = root.querySelector('[data-review-drawer]');
  const drawerToggle = root.querySelector('[data-toggle-review-drawer]');
  const lightbox = root.querySelector('[data-review-lightbox]');
  const lightboxImage = lightbox?.querySelector?.('img');
  const lightboxClose = lightbox?.querySelector?.('[data-close-lightbox]');
  let lightboxTrigger = null;
  let active = true;
  const drawerTrap = createFocusTrap(drawer, { documentRef });
  const lightboxTrap = createFocusTrap(lightbox, { documentRef });
  const cleanupLiveMaps = mountReviewLiveMaps(root, { documentRef, windowRef });
  const cleanupRail = mountReviewRail(root);

  const setDrawer = (open, { moveFocus = false, restoreFocus = false } = {}) => {
    if (!drawer || !drawerToggle) return;
    drawer.hidden = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    drawer.classList.toggle('is-open', open);
    drawerToggle.setAttribute('aria-expanded', String(open));
    if (open && moveFocus) {
      const firstTarget = drawer.querySelector('[data-close-review-drawer]')
        ?? drawer.querySelector('.review-chapter-link');
      drawerTrap.activate({ initialFocus: firstTarget, returnFocus: drawerToggle });
    } else if (!open) {
      drawerTrap.deactivate({ restoreFocus: restoreFocus && active });
    }
  };

  const closeLightbox = ({ restoreFocus = true } = {}) => {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImage?.removeAttribute?.('src');
    lightboxTrap.deactivate({ restoreFocus: restoreFocus && active });
    lightboxTrigger = null;
  };

  const onClick = (event) => {
    const closest = (selector) => event.target?.closest?.(selector);
    if (closest('[data-toggle-review-drawer]')) {
      setDrawer(drawer?.hidden ?? !drawer?.classList.contains('is-open'), { moveFocus: true });
      return;
    }
    if (closest('[data-close-review-drawer]')) {
      setDrawer(false, { restoreFocus: true });
      return;
    }
    if (closest('.review-chapter-link')) {
      setDrawer(false);
      return;
    }
    const imageTrigger = closest('[data-lightbox-trigger]');
    if (imageTrigger && lightbox && lightboxImage) {
      lightboxTrigger = imageTrigger;
      lightboxImage.src = imageTrigger.getAttribute('data-lightbox-src');
      lightboxImage.alt = imageTrigger.getAttribute('data-lightbox-alt') || '';
      lightbox.hidden = false;
      lightboxTrap.activate({ initialFocus: lightboxClose, returnFocus: imageTrigger });
      return;
    }
    if (closest('[data-close-lightbox]') || (event.target === lightbox)) closeLightbox();
  };

  const onKeydown = (event) => {
    if (lightboxTrap.handleKeydown(event) || drawerTrap.handleKeydown(event)) return;
    if (event.key === 'Escape') {
      if (lightbox && !lightbox.hidden) {
        event.preventDefault?.();
        closeLightbox();
      } else {
        const drawerWasOpen = drawer && !drawer.hidden;
        setDrawer(false, { restoreFocus: drawerWasOpen });
      }
      return;
    }
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    if (event.target?.closest?.('input, textarea, select, video, [contenteditable="true"]')) return;
    const selector = event.key === 'ArrowLeft' ? '[data-review-prev]' : '[data-review-next]';
    const href = root.querySelector(selector)?.getAttribute?.('href');
    if (!href) return;
    event.preventDefault?.();
    navigateTo(windowRef, href);
  };

  root.addEventListener?.('click', onClick);
  documentRef.addEventListener?.('keydown', onKeydown);
  return () => {
    active = false;
    root.removeEventListener?.('click', onClick);
    documentRef.removeEventListener?.('keydown', onKeydown);
    lightboxTrap.deactivate({ restoreFocus: false });
    cleanupLiveMaps();
    cleanupRail();
    setDrawer(false);
    root.querySelectorAll?.('.review-media-video').forEach((video) => video.pause());
  };
}

function loadingView() {
  return `<section class="review-status-view app-view" data-review-loading><p>REVIEW NOTES</p><h1>正在打开复盘手记</h1><span>请稍候……</span></section>`;
}

let reviewDataCache = new WeakMap();

function availableFetch(fetchImpl) {
  return typeof fetchImpl === 'function' ? fetchImpl : null;
}

export function peekReviewData(fetchImpl = globalThis.fetch) {
  const implementation = availableFetch(fetchImpl);
  return implementation ? reviewDataCache.get(implementation)?.data ?? null : null;
}

export function resetReviewDataCache() {
  reviewDataCache = new WeakMap();
}

export function loadReviewData(fetchImpl = globalThis.fetch, { force = false } = {}) {
  const implementation = availableFetch(fetchImpl);
  if (!implementation) return Promise.reject(new Error('No fetch implementation is available for review data.'));

  const current = reviewDataCache.get(implementation);
  if (!force && current) return current.fulfilled ? Promise.resolve(current.data) : current.promise;

  const entry = {};
  entry.promise = Promise.resolve()
    .then(() => implementation('data/review.json'))
    .then((response) => {
      if (!response?.ok) throw new Error(`Review data request failed: ${response?.status ?? 'unknown'}`);
      return response.json();
    })
    .then((data) => {
      if (reviewDataCache.get(implementation) === entry) {
        entry.data = data;
        entry.fulfilled = true;
      }
      return data;
    })
    .catch((error) => {
      if (reviewDataCache.get(implementation) === entry) reviewDataCache.delete(implementation);
      throw error;
    });
  reviewDataCache.set(implementation, entry);
  return entry.promise;
}

function errorView() {
  return `<section class="review-status-view app-view" data-review-error><p>REVIEW NOTES</p><h1>复盘手记暂时无法载入</h1><span>请检查连接后重试。</span><button type="button" data-retry-review>重新载入</button><a href="#after">返回片后</a></section>`;
}

function missingChapterView() {
  return `<section class="review-status-view app-view" data-review-missing><p>REVIEW NOTES</p><h1>没有找到这一章</h1><span>章节地址可能已经变化。</span><a href="#review">回到复盘目录</a><a href="#after">返回片后</a></section>`;
}

export function mountReviewRoute(app, route, {
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  documentRef = document,
  windowRef = window,
} = {}) {
  let active = true;
  let interactionCleanup = () => {};
  let retryButton = null;
  let retryHandler = null;
  let loadVersion = 0;

  const clearRetry = () => {
    retryButton?.removeEventListener?.('click', retryHandler);
    retryButton = null;
    retryHandler = null;
  };

  const renderData = (data) => {
    interactionCleanup();
    clearRetry();
    if (route.name === 'review-index') {
      app.innerHTML = buildReviewIndex(data, readReviewProgress(storage));
    } else {
      const target = normalizeReviewTarget(data, route.chapter, route.page);
      if (!target) {
        app.innerHTML = missingChapterView();
      } else {
        app.innerHTML = buildReviewPage(data, target);
        writeReviewProgress(storage, { chapter: target.chapter.slug, page: target.page });
        const scrollRegion = app.querySelector?.('[data-review-scroll]');
        if (scrollRegion) scrollRegion.scrollTop = 0;
      }
    }
    interactionCleanup = bindReviewInteractions(app, { documentRef, windowRef });
    app.focus?.({ preventScroll: true });
  };

  const renderError = () => {
    app.innerHTML = errorView();
    retryButton = app.querySelector?.('[data-retry-review]');
    retryHandler = () => load({ force: true });
    retryButton?.addEventListener?.('click', retryHandler);
    app.focus?.({ preventScroll: true });
  };

  const load = async ({ force = false } = {}) => {
    const version = ++loadVersion;
    interactionCleanup();
    clearRetry();

    try {
      const cached = !force && peekReviewData(fetchImpl);
      if (cached) {
        if (active && version === loadVersion) renderData(cached);
        return;
      }
      app.innerHTML = loadingView();
      const data = await loadReviewData(fetchImpl, { force });
      if (!active || version !== loadVersion) return;
      renderData(data);
    } catch (error) {
      if (!active || version !== loadVersion) return;
      renderError();
    }
  };

  load();
  return () => {
    active = false;
    loadVersion += 1;
    clearRetry();
    interactionCleanup();
  };
}
