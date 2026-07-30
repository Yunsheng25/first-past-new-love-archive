function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function caseList(data) {
  return Array.isArray(data?.cases) ? data.cases : [];
}

/** Finds a case only when the occurrence identifies one of its exact images. */
export function resolveCaseFromOccurrence(data, occurrence) {
  if (!occurrence || typeof occurrence !== 'object') return null;
  if (!Number.isInteger(occurrence.imageIndex)) return null;
  const item = caseList(data).find((candidate) => candidate?.id === occurrence.caseId);
  if (!item || !Array.isArray(item.images)) return null;
  const image = item.images[occurrence.imageIndex];
  if (!image) return null;
  for (const key of ['src', 'role']) {
    if (occurrence[key] !== undefined && occurrence[key] !== image[key]) return null;
  }
  if (occurrence.caseIndex !== undefined && occurrence.caseIndex !== caseList(data).indexOf(item)) return null;
  return item;
}

/** Returns the authored neighbor. delta is rounded to an integer; zero is invalid. */
export function caseNeighbor(data, caseId, delta) {
  const cases = caseList(data);
  const index = cases.findIndex((item) => item?.id === caseId);
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (index < 0 || step === 0) return null;
  return cases[index + step] ?? null;
}

function galleryLayout(images) {
  if (images.length === 1) return 'one';
  if (images.length === 2) return 'two';
  return 'many';
}

function promptMarkup(prompt) {
  return escapeHtml(prompt ?? '').replace(/\r?\n/g, '<br>');
}

export function buildArchiveCaseModal(caseItem, occurrence = null, { totalCases = 0 } = {}) {
  if (!caseItem || typeof caseItem !== 'object') return '';
  const images = Array.isArray(caseItem.images) ? caseItem.images : [];
  const layout = galleryLayout(images);
  const headingId = `archive-case-modal-title-${escapeHtml(caseItem.id ?? 'case')}`;
  const selectedIndex = Number.isInteger(occurrence?.imageIndex) ? occurrence.imageIndex : -1;
  const imageMarkup = images.map((image, index) => `<figure class="archive-case-image" data-case-image-role="${escapeHtml(image?.role)}" data-case-image-index="${index}"${index === selectedIndex ? ' data-case-image-selected="true"' : ''}>
    <img src="${escapeHtml(image?.originalSrc ?? image?.src)}" alt="${escapeHtml(`${caseItem.title ?? ''} · ${image?.role ?? ''}`)}" loading="lazy" decoding="async">
    <figcaption>${escapeHtml(image?.role)}</figcaption>
  </figure>`).join('');
  const position = Number.isFinite(caseItem.index) ? caseItem.index : '';
  const total = Number.isFinite(totalCases) && totalCases > 0 ? totalCases : '';
  const isError = caseItem.status === 'error';
  const errorReason = caseItem.errorReason ?? caseItem.errorGroup ?? '未标注原因';
  const errorState = isError ? `<aside class="archive-case-error-state" data-case-error-state>
        <strong>错误尝试</strong><span>失败原因</span><p>${escapeHtml(errorReason)}</p>${caseItem.errorReason && caseItem.errorGroup && caseItem.errorReason !== caseItem.errorGroup ? `<small>白板分组：${escapeHtml(caseItem.errorGroup)}</small>` : ''}
      </aside>` : '';
  return `<div class="archive-case-modal-backdrop" data-case-modal-backdrop>
    <section class="archive-case-modal" data-case-modal role="dialog" aria-modal="true" aria-labelledby="${headingId}" tabindex="-1">
      <header><p data-case-modal-index>${escapeHtml(position)}${total ? ` / ${escapeHtml(total)}` : ''}</p><h2 id="${headingId}">${escapeHtml(caseItem.title)}</h2><button type="button" data-case-modal-close aria-label="关闭案例">×</button></header>
      ${errorState}
      <div class="archive-case-modal-controls"><button type="button" data-case-modal-previous${position === 1 ? ' disabled aria-disabled="true"' : ''}>上一案例</button><button type="button" data-case-modal-next${total && position === total ? ' disabled aria-disabled="true"' : ''}>下一案例</button><button type="button" data-case-modal-copy${String(caseItem.prompt ?? '') ? '' : ' disabled'}>复制提示词</button><span data-case-modal-copy-status aria-live="polite"></span></div>
      <div class="archive-case-gallery archive-case-gallery-${layout}" data-case-gallery="${layout}" data-case-gallery-layout="${layout}">${imageMarkup}</div>
      <p class="archive-case-prompt" data-case-modal-prompt>${promptMarkup(caseItem.prompt)}</p>
    </section>
  </div>`;
}

function closest(target, selector) {
  try { return target?.closest?.(selector) ?? (target?.selector === selector ? target : null); } catch { return null; }
}

function focusables(card) {
  return [...(card?.querySelectorAll?.('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
    .filter((element) => !element.disabled && !element.hidden);
}

async function copyText(text, navigatorRef, documentRef, isCurrent = () => true) {
  if (!text) return false;
  try {
    if (typeof navigatorRef?.clipboard?.writeText === 'function') {
      await navigatorRef.clipboard.writeText(text);
      return true;
    }
  } catch { /* Fall through to the browser compatibility path. */ }
  if (!isCurrent()) return false;
  let textarea = null;
  let originalActive = null;
  let selection = null;
  const ranges = [];
  try {
    if (typeof documentRef?.createElement !== 'function' || typeof documentRef?.execCommand !== 'function') return false;
    try { originalActive = documentRef.activeElement ?? null; } catch { /* unavailable */ }
    try {
      selection = documentRef.getSelection?.() ?? null;
      for (let index = 0; index < (Number(selection?.rangeCount) || 0); index += 1) {
        const range = selection.getRangeAt(index);
        ranges.push(range?.cloneRange?.() ?? range);
      }
    } catch { selection = null; ranges.length = 0; }
    if (!isCurrent()) return false;
    textarea = documentRef.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute?.('readonly', '');
    Object.assign(textarea.style ?? {}, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
    if (!isCurrent()) return false;
    documentRef.body?.append?.(textarea);
    if (!isCurrent()) return false;
    textarea.select?.();
    if (!isCurrent()) return false;
    return documentRef.execCommand('copy') === true;
  } catch { return false; } finally {
    try { textarea?.remove?.(); } catch { /* inert cleanup */ }
    if (selection) {
      try { selection.removeAllRanges?.(); } catch { /* ignored */ }
      for (const range of ranges) try { selection.addRange?.(range); } catch { /* ignored */ }
    }
    try { if (originalActive?.isConnected !== false) originalActive?.focus?.({ preventScroll: true }); } catch { /* ignored */ }
  }
}

/** Mounts an in-place complete-case dialog. The returned controller can close it safely. */
export function mountArchiveCaseModal(host, {
  data,
  occurrence,
  trigger = null,
  onClose = () => {},
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
} = {}) {
  let item = resolveCaseFromOccurrence(data, occurrence);
  if (!host || !item) {
    try { onClose?.(); } catch { /* consumer errors cannot escape */ }
    return null;
  }
  let selectedOccurrence = occurrence;
  let active = true;
  let closed = false;
  let closeReported = false;
  let version = 0;

  const render = () => {
    if (!active) return;
    host.innerHTML = buildArchiveCaseModal(item, selectedOccurrence, { totalCases: caseList(data).length });
    const card = host.querySelector?.('[data-case-modal]');
    const previous = host.querySelector?.('[data-case-modal-previous]');
    const next = host.querySelector?.('[data-case-modal-next]');
    const index = caseList(data).indexOf(item);
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index >= caseList(data).length - 1;
    return card;
  };

  const cleanup = () => {
    try { host.removeEventListener?.('click', click); } catch { /* ignored */ }
    try { documentRef?.removeEventListener?.('keydown', keydown); } catch { /* ignored */ }
  };
  const close = () => {
    if (closed) return false;
    closed = true;
    active = false;
    version += 1;
    cleanup();
    try { host.innerHTML = ''; } catch { /* host may already be detached */ }
    try { if (trigger?.isConnected !== false) trigger?.focus?.({ preventScroll: true }); } catch { /* best effort */ }
    if (!closeReported) {
      closeReported = true;
      try { onClose?.(); } catch { /* consumer errors cannot escape */ }
    }
    return true;
  };
  const navigate = (delta) => {
    if (!active) return false;
    const nextItem = caseNeighbor(data, item.id, delta);
    if (!nextItem) return false;
    // A completed navigation makes every pending copy result stale.
    version += 1;
    item = nextItem;
    selectedOccurrence = { caseId: item.id, caseIndex: caseList(data).indexOf(item), imageIndex: 0, src: item.images?.[0]?.src, role: item.images?.[0]?.role };
    render();
    try { host.querySelector?.('[data-case-modal-close]')?.focus?.({ preventScroll: true }); } catch { /* best effort */ }
    return true;
  };
  const click = (event) => {
    if (!active) return;
    const target = event?.target;
    if (target === host || closest(target, '[data-case-modal-backdrop]') === target) { close(); return; }
    if (closest(target, '[data-case-modal-close]')) { event?.preventDefault?.(); close(); return; }
    if (closest(target, '[data-case-modal-previous]')) { event?.preventDefault?.(); navigate(-1); return; }
    if (closest(target, '[data-case-modal-next]')) { event?.preventDefault?.(); navigate(1); return; }
    if (closest(target, '[data-case-modal-copy]')) {
      event?.preventDefault?.();
      const prompt = String(item.prompt ?? '');
      if (!prompt) return;
      const token = ++version;
      const status = host.querySelector?.('[data-case-modal-copy-status]');
      Promise.resolve(copyText(prompt, navigatorRef, documentRef, () => active && token === version)).then((copied) => {
        if (!active || token !== version) return;
        if (status) status.textContent = copied ? '已复制' : '复制失败';
      }).catch(() => { if (active && token === version && status) status.textContent = '复制失败'; });
    }
  };
  const keydown = (event) => {
    if (!active) return;
    if (event?.key === 'Escape') { event.preventDefault?.(); close(); return; }
    if (event?.key !== 'Tab') return;
    const card = host.querySelector?.('[data-case-modal]');
    const items = focusables(card);
    if (!items.length) return;
    event.preventDefault?.();
    const current = documentRef?.activeElement;
    const index = items.indexOf(current);
    const nextIndex = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index >= items.length - 1 ? 0 : index + 1);
    try { items[nextIndex].focus?.({ preventScroll: true }); } catch { /* best effort */ }
  };

  render();
  host.addEventListener?.('click', click);
  documentRef?.addEventListener?.('keydown', keydown);
  try { host.querySelector?.('[data-case-modal-close]')?.focus?.({ preventScroll: true }); } catch { /* best effort */ }
  return Object.freeze({ close, destroy: close, navigate, get occurrence() { return selectedOccurrence; }, get caseItem() { return item; } });
}
