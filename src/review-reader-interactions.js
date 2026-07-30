import {
  createTextQuoteAnchor,
  readReaderState,
  upsertAnnotation,
  writeReaderState,
} from './review-annotations.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createReviewWheelController({
  navigate,
  clock = () => performance.now(),
  threshold = 58,
  cooldown = 900,
} = {}) {
  let total = 0;
  let lastTurn = -Infinity;
  return {
    push(delta) {
      const now = clock();
      if (now - lastTurn < cooldown) return false;
      total += Number(delta) || 0;
      if (Math.abs(total) < threshold) return false;
      navigate?.(total > 0 ? 1 : -1);
      total = 0;
      lastTurn = now;
      return true;
    },
    reset() {
      total = 0;
    },
  };
}

export function filterReviewAnnotations(annotations = [], filter = 'all') {
  if (filter === 'highlight') return annotations.filter((item) => item.kind === 'highlight');
  if (filter === 'note') return annotations.filter((item) => item.kind === 'note');
  return [...annotations];
}

export function reviewNotebookMarkup(annotations = []) {
  if (annotations.length === 0) {
    return '<p class="review-notebook-empty">选择正文中的任意文字，就可以在这里汇总高亮和批注。</p>';
  }
  return annotations.map((annotation) => `
    <article class="review-notebook-item" data-review-annotation-id="${escapeHtml(annotation.id)}">
      <small>${escapeHtml(annotation.chapter || '复盘手记')} · 第 ${escapeHtml(annotation.page || 1)} 页</small>
      <blockquote>${escapeHtml(annotation.quote)}</blockquote>
      ${annotation.kind === 'note' ? `<p>${escapeHtml(annotation.note)}</p>` : '<span>仅高亮</span>'}
    </article>`).join('');
}

export function createReviewCaseDetailController({
  detail,
  content,
  closeButton,
} = {}) {
  let returnFocus = null;
  return {
    open(callout, trigger) {
      if (!detail || !content || !callout) return false;
      const clone = callout.cloneNode(true);
      clone.querySelector?.('.review-callout-actions')?.remove?.();
      content.replaceChildren?.(clone);
      returnFocus = trigger ?? null;
      detail.hidden = false;
      detail.classList?.add?.('is-open');
      closeButton?.focus?.({ preventScroll: true });
      return true;
    },
    close({ restoreFocus = true } = {}) {
      if (!detail || detail.hidden) return false;
      detail.querySelectorAll?.('video').forEach((video) => video.pause?.());
      detail.hidden = true;
      detail.classList?.remove?.('is-open');
      content?.replaceChildren?.();
      const target = returnFocus;
      returnFocus = null;
      if (restoreFocus) target?.focus?.({ preventScroll: true });
      return true;
    },
    isOpen() {
      return Boolean(detail && !detail.hidden);
    },
  };
}

function annotationId(chapter, page, anchor, windowRef) {
  const uuid = windowRef.crypto?.randomUUID?.();
  return uuid || `${chapter}-${page}-${anchor.quote.length}-${Date.now().toString(36)}`;
}

function pageRangeOffsets(page, range, documentRef) {
  const prefixRange = documentRef.createRange();
  prefixRange.selectNodeContents(page);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const start = prefixRange.toString().length;
  return { start, end: start + range.toString().length };
}

function wrapRange(range, annotation) {
  if (!range || range.collapsed) return null;
  const mark = range.startContainer.ownerDocument.createElement('mark');
  mark.className = `review-user-highlight${annotation.kind === 'note' ? ' has-note' : ''}`;
  mark.dataset.reviewAnnotationId = annotation.id;
  try {
    mark.append(range.extractContents());
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

function textNodes(root, documentRef) {
  const walker = documentRef.createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function quoteIndex(text, annotation) {
  let index = text.indexOf(annotation.quote);
  while (index >= 0) {
    const prefixMatches = !annotation.prefix
      || text.slice(Math.max(0, index - annotation.prefix.length), index) === annotation.prefix;
    const end = index + annotation.quote.length;
    const suffixMatches = !annotation.suffix
      || text.slice(end, end + annotation.suffix.length) === annotation.suffix;
    if (prefixMatches && suffixMatches) return index;
    index = text.indexOf(annotation.quote, index + 1);
  }
  return -1;
}

function restoreAnnotation(page, annotation, documentRef) {
  const safeId = globalThis.CSS?.escape?.(annotation.id) ?? annotation.id;
  if (!annotation.quote || page.querySelector?.(`[data-review-annotation-id="${safeId}"]`)) return;
  const contentRoot = page.querySelector?.('.review-paper-content') ?? page;
  const nodes = textNodes(contentRoot, documentRef)
    .filter((node) => !node.parentElement?.closest?.('.review-callout-actions'));
  const fullText = nodes.map((node) => node.nodeValue).join('');
  const start = quoteIndex(fullText, annotation);
  if (start < 0) return;
  const end = start + annotation.quote.length;
  let offset = 0;
  let startNode;
  let startOffset;
  let endNode;
  let endOffset;
  for (const node of nodes) {
    const next = offset + node.nodeValue.length;
    if (!startNode && start >= offset && start <= next) {
      startNode = node;
      startOffset = start - offset;
    }
    if (end >= offset && end <= next) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = next;
  }
  if (!startNode || !endNode) return;
  const range = documentRef.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  wrapRange(range, annotation);
}

export function mountReviewReaderInteractions(root, {
  documentRef = document,
  windowRef = window,
  storage = globalThis.localStorage,
} = {}) {
  const spread = root.querySelector?.('[data-review-spread]');
  if (!spread) return () => {};

  const immersiveButton = root.querySelector?.('[data-review-immersive]');
  const exitImmersiveButton = root.querySelector?.('[data-review-exit-immersive]');
  const settingsButton = root.querySelector?.('[data-review-settings]');
  const settingsPanel = root.querySelector?.('[data-review-settings-panel]');
  const notebookButton = root.querySelector?.('[data-review-notebook]');
  const notebookPanel = root.querySelector?.('[data-review-notebook-panel]');
  const notebookList = root.querySelector?.('[data-review-notebook-list]');
  const selectionTools = root.querySelector?.('[data-review-selection-tools]');
  const noteEditor = root.querySelector?.('[data-review-note-editor]');
  const caseDetail = root.querySelector?.('[data-review-case-detail]');
  const caseDetailContent = root.querySelector?.('[data-review-case-detail-content]');
  const caseDetailClose = root.querySelector?.('[data-review-case-detail-close]');
  const caseDetailController = createReviewCaseDetailController({
    detail: caseDetail,
    content: caseDetailContent,
    closeButton: caseDetailClose,
  });
  let state = readReaderState(storage);
  let savedRange = null;
  let pendingAnnotation = null;
  let notebookFilter = 'all';
  let active = true;

  const persist = () => writeReaderState(storage, state);
  const visibleAnnotations = () => {
    const visible = new Set([...root.querySelectorAll?.('.review-spread-page') ?? []]
      .map((page) => `${page.dataset.reviewChapter}:${page.dataset.reviewPageNumber}`));
    return state.annotations.filter((item) => visible.has(`${item.chapter}:${item.page}`));
  };
  const renderNotebook = () => {
    if (notebookList) {
      notebookList.innerHTML = reviewNotebookMarkup(filterReviewAnnotations(state.annotations, notebookFilter));
    }
  };
  const applyReaderState = () => {
    root.dataset.reviewTheme = state.theme;
    root.style?.setProperty?.('--review-font-size', `${state.fontSize}px`);
    root.querySelectorAll?.('[data-review-theme]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.reviewTheme === state.theme);
    });
    const fontInput = root.querySelector?.('[data-review-font-size]');
    if (fontInput) fontInput.value = String(state.fontSize);
  };

  const navigate = (direction) => {
    const selector = direction > 0 ? '[data-review-next]' : '[data-review-prev]';
    const href = root.querySelector?.(selector)?.getAttribute?.('href');
    if (href) windowRef.location.hash = href.replace(/^#/, '');
  };
  const wheel = createReviewWheelController({ navigate });

  const setImmersive = async (enabled) => {
    root.classList.toggle('is-immersive', enabled);
    documentRef.body?.classList?.toggle?.('review-immersive', enabled);
    immersiveButton?.setAttribute?.('aria-pressed', String(enabled));
    if (enabled) {
      try { await root.requestFullscreen?.(); } catch {}
    } else {
      try {
        if (documentRef.fullscreenElement) await documentRef.exitFullscreen?.();
      } catch {}
    }
  };

  const onWheel = (event) => {
    if (event.target?.closest?.('video, input, textarea, select, [contenteditable="true"], [data-scrollable="true"]')) return;
    event.preventDefault?.();
    wheel.push(event.deltaY);
  };

  const onMouseUp = () => {
    const selection = documentRef.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const page = element?.closest?.('.review-spread-page');
    if (!page || !root.contains?.(page)) return;
    const contentRoot = page.querySelector?.('.review-paper-content') ?? page;
    if (!contentRoot.contains?.(range.commonAncestorContainer)) return;
    const { start, end } = pageRangeOffsets(contentRoot, range, documentRef);
    const anchor = createTextQuoteAnchor(contentRoot.textContent, start, end);
    savedRange = range.cloneRange();
    pendingAnnotation = {
      ...anchor,
      id: annotationId(page.dataset.reviewChapter, page.dataset.reviewPageNumber, anchor, windowRef),
      chapter: page.dataset.reviewChapter,
      page: Number(page.dataset.reviewPageNumber),
    };
    if (selectionTools) {
      const rect = range.getBoundingClientRect();
      selectionTools.hidden = false;
      selectionTools.style.left = `${Math.max(12, rect.left + rect.width / 2)}px`;
      selectionTools.style.top = `${Math.max(82, rect.top - 46)}px`;
    }
  };

  const saveAnnotation = (kind, note = '') => {
    if (!pendingAnnotation || !savedRange) return;
    const annotation = { ...pendingAnnotation, kind, note };
    if (!wrapRange(savedRange, annotation)) return;
    state = upsertAnnotation(state, annotation);
    persist();
    renderNotebook();
    documentRef.getSelection?.()?.removeAllRanges?.();
    savedRange = null;
    pendingAnnotation = null;
    if (selectionTools) selectionTools.hidden = true;
  };

  const onClick = (event) => {
    const closest = (selector) => event.target?.closest?.(selector);
    if (closest('[data-review-immersive]')) setImmersive(!root.classList.contains('is-immersive'));
    else if (closest('[data-review-exit-immersive]')) setImmersive(false);
    else if (closest('[data-review-settings]')) {
      const open = settingsPanel?.hidden ?? true;
      if (settingsPanel) settingsPanel.hidden = !open;
      settingsButton?.setAttribute?.('aria-expanded', String(open));
    } else if (closest('[data-review-theme]')) {
      state = { ...state, theme: closest('[data-review-theme]').dataset.reviewTheme };
      applyReaderState();
      persist();
    } else if (closest('[data-review-notebook]')) {
      const open = notebookPanel?.hidden ?? true;
      if (notebookPanel) notebookPanel.hidden = !open;
      notebookButton?.setAttribute?.('aria-expanded', String(open));
      renderNotebook();
    } else if (closest('[data-review-notebook-close]')) {
      if (notebookPanel) notebookPanel.hidden = true;
      notebookButton?.setAttribute?.('aria-expanded', 'false');
    } else if (closest('[data-review-note-filter]')) {
      notebookFilter = closest('[data-review-note-filter]').dataset.reviewNoteFilter;
      renderNotebook();
    } else if (closest('[data-review-highlight]')) {
      saveAnnotation('highlight');
    } else if (closest('[data-review-add-note]')) {
      if (noteEditor && pendingAnnotation) {
        noteEditor.hidden = false;
        noteEditor.querySelector('[data-review-note-quote]').textContent = pendingAnnotation.quote;
        noteEditor.querySelector('[data-review-note-text]')?.focus?.();
      }
    } else if (closest('[data-review-note-save]')) {
      const note = noteEditor?.querySelector?.('[data-review-note-text]')?.value?.trim?.() ?? '';
      saveAnnotation('note', note);
      if (noteEditor) noteEditor.hidden = true;
    } else if (closest('[data-review-note-cancel]')) {
      if (noteEditor) noteEditor.hidden = true;
    } else if (closest('[data-review-callout-detail]')) {
      const trigger = closest('[data-review-callout-detail]');
      caseDetailController.open(trigger.closest('.review-callout'), trigger);
    } else if (closest('[data-review-case-detail-close]') || event.target === caseDetail) {
      caseDetailController.close();
    }
  };

  const onInput = (event) => {
    if (!event.target?.matches?.('[data-review-font-size]')) return;
    state = { ...state, fontSize: Number(event.target.value) };
    applyReaderState();
    persist();
  };
  const onKeydown = (event) => {
    if (event.key !== 'Escape' || !caseDetailController.isOpen()) return;
    event.preventDefault?.();
    caseDetailController.close();
  };
  const onFullscreenChange = () => {
    if (active && !documentRef.fullscreenElement) {
      root.classList.remove('is-immersive');
      documentRef.body?.classList?.remove?.('review-immersive');
      immersiveButton?.setAttribute?.('aria-pressed', 'false');
    }
  };

  spread.addEventListener?.('wheel', onWheel, { passive: false });
  spread.addEventListener?.('mouseup', onMouseUp);
  root.addEventListener?.('click', onClick);
  root.addEventListener?.('input', onInput);
  documentRef.addEventListener?.('fullscreenchange', onFullscreenChange);
  documentRef.addEventListener?.('keydown', onKeydown);

  applyReaderState();
  renderNotebook();
  for (const annotation of visibleAnnotations()) {
    const page = root.querySelector?.(
      `[data-review-chapter="${annotation.chapter}"][data-review-page-number="${annotation.page}"]`,
    );
    if (page) restoreAnnotation(page, annotation, documentRef);
  }

  return () => {
    active = false;
    spread.removeEventListener?.('wheel', onWheel);
    spread.removeEventListener?.('mouseup', onMouseUp);
    root.removeEventListener?.('click', onClick);
    root.removeEventListener?.('input', onInput);
    documentRef.removeEventListener?.('fullscreenchange', onFullscreenChange);
    documentRef.removeEventListener?.('keydown', onKeydown);
    caseDetailController.close({ restoreFocus: false });
    documentRef.body?.classList?.remove?.('review-immersive');
  };
}
