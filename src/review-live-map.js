import { REVIEW_LIVE_MAPS, visibleReviewMapNodes } from './review-live-map-model.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function depthFor(map, target) {
  const queue = map.roots.map((id) => [id, 0]);
  const seen = new Set();
  while (queue.length) {
    const [id, depth] = queue.shift();
    if (id === target) return depth;
    if (seen.has(id)) continue;
    seen.add(id);
    (map.nodes[id]?.children ?? []).forEach((child) => queue.push([child, depth + 1]));
  }
  return 0;
}

function positionsFor(map, ids) {
  const byDepth = new Map();
  ids.forEach((id) => {
    const depth = depthFor(map, id);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(id);
  });
  const positions = new Map();
  byDepth.forEach((depthIds, depth) => {
    depthIds.forEach((id, index) => positions.set(id, {
      x: 220 + depth * 340,
      y: 120 + index * 190 + Math.max(0, 3 - depthIds.length) * 55,
      width: 250,
      height: 118,
    }));
  });
  return positions;
}

function detailMarkup(node) {
  const media = (node.media ?? []).map((src) =>
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.title)}案例图片" loading="lazy" decoding="async">`
  ).join('');
  return `<button type="button" data-review-map-detail-close aria-label="关闭节点内容">×</button>
    <h3>${escapeHtml(node.title)}</h3>
    ${media ? `<div class="review-map-detail-media">${media}</div>` : ''}
    <p>${escapeHtml(node.detail || '这一节点的详细内容来自复盘手记对应段落。')}</p>`;
}

export function mountReviewLiveMaps(root, { documentRef = document } = {}) {
  const triggers = [...(root.querySelectorAll?.('[data-review-live-map]') ?? [])];
  if (!triggers.length) return () => {};
  let overlay = null;
  let trigger = null;
  let map = null;
  let expanded = new Set();
  let x = 55;
  let y = 35;
  let scale = .72;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;
  let originalScroll = 0;

  const renderCamera = () => {
    const world = overlay?.querySelector('[data-review-map-world]');
    if (world) world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  const draw = () => {
    if (!overlay || !map) return;
    const host = overlay.querySelector('[data-review-map-nodes]');
    const svg = overlay.querySelector('[data-review-map-edges]');
    const visible = visibleReviewMapNodes(map, expanded);
    const positions = positionsFor(map, visible);
    host.innerHTML = visible.map((id) => {
      const node = map.nodes[id];
      const box = positions.get(id);
      const expandable = Boolean(node.children?.length);
      return `<button type="button" class="review-live-node${expanded.has(id) ? ' is-expanded' : ''}" data-review-map-node="${escapeHtml(id)}" style="left:${box.x}px;top:${box.y}px">
        <strong>${escapeHtml(node.title)}</strong>
        <small>${expandable ? (expanded.has(id) ? '已展开' : '点击继续展开') : '查看对应内容'}</small>
      </button>`;
    }).join('');
    const paths = [];
    visible.forEach((fromId) => {
      if (!expanded.has(fromId)) return;
      const from = positions.get(fromId);
      (map.nodes[fromId]?.children ?? []).forEach((toId) => {
        const to = positions.get(toId);
        if (!to) return;
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        paths.push(`<path d="M${x1} ${y1} C${x1 + 95} ${y1},${x2 - 95} ${y2},${x2} ${y2}"/>`);
      });
    });
    svg.innerHTML = paths.join('');
    renderCamera();
  };

  const close = () => {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    documentRef.documentElement?.classList.remove('review-map-open');
    const scroller = root.querySelector('[data-review-scroll]');
    if (scroller) scroller.scrollTop = originalScroll;
    trigger?.focus?.();
    trigger = null;
  };

  const reset = () => {
    expanded = new Set();
    x = 55;
    y = 35;
    scale = .72;
    overlay?.querySelector('[data-review-map-detail]')?.setAttribute('hidden', '');
    draw();
  };

  const overview = () => {
    const viewport = overlay?.querySelector('[data-review-map-viewport]');
    if (!viewport) return;
    const visible = visibleReviewMapNodes(map, expanded);
    const positions = [...positionsFor(map, visible).values()];
    const maxX = Math.max(...positions.map((item) => item.x + item.width), 1000);
    const maxY = Math.max(...positions.map((item) => item.y + item.height), 650);
    scale = Math.min(.95, (viewport.clientWidth - 80) / maxX, (viewport.clientHeight - 80) / maxY);
    x = 40;
    y = 40;
    renderCamera();
  };

  const open = (nextTrigger) => {
    map = REVIEW_LIVE_MAPS[nextTrigger.dataset.reviewLiveMap];
    if (!map) return;
    close();
    trigger = nextTrigger;
    originalScroll = root.querySelector('[data-review-scroll]')?.scrollTop ?? 0;
    overlay = documentRef.createElement('section');
    overlay.className = 'review-live-map';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', map.title);
    overlay.innerHTML = `<header class="review-live-map-header">
      <div><b>${escapeHtml(map.title)}</b><span>INTERACTIVE REVIEW MAP</span></div>
      <nav><button type="button" data-review-map-overview>总览</button><button type="button" data-review-map-reset>恢复原样</button><button type="button" data-review-map-close>关闭 ×</button></nav>
    </header>
    <div class="review-live-map-viewport" data-review-map-viewport>
      <div class="review-live-map-world" data-review-map-world>
        <svg data-review-map-edges viewBox="0 0 2600 1300"></svg>
        <div data-review-map-nodes></div>
      </div>
      <aside class="review-map-detail" data-review-map-detail hidden></aside>
      <p class="review-live-map-hint">拖动画布 · 滚轮缩放 · 点击节点逐层展开</p>
    </div>`;
    root.append(overlay);
    documentRef.documentElement?.classList.add('review-map-open');
    reset();
    overlay.querySelector('[data-review-map-close]')?.focus?.();
  };

  const onClick = (event) => {
    const nextTrigger = event.target?.closest?.('[data-review-live-map]');
    if (nextTrigger) { open(nextTrigger); return; }
    if (!overlay) return;
    if (event.target.closest('[data-review-map-close]')) { close(); return; }
    if (event.target.closest('[data-review-map-reset]')) { reset(); return; }
    if (event.target.closest('[data-review-map-overview]')) { overview(); return; }
    if (event.target.closest('[data-review-map-detail-close]')) {
      overlay.querySelector('[data-review-map-detail]').hidden = true;
      return;
    }
    const nodeButton = event.target.closest('[data-review-map-node]');
    if (!nodeButton) return;
    const id = nodeButton.dataset.reviewMapNode;
    const node = map.nodes[id];
    if (node.children?.length) {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      draw();
    } else {
      const detail = overlay.querySelector('[data-review-map-detail]');
      detail.innerHTML = detailMarkup(node);
      detail.hidden = false;
    }
  };

  const onPointerDown = (event) => {
    if (!overlay || event.target.closest('button,.review-map-detail')) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    overlay.classList.add('is-dragging');
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    x += event.clientX - pointerX;
    y += event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    renderCamera();
  };
  const onPointerUp = () => {
    dragging = false;
    overlay?.classList.remove('is-dragging');
  };
  const onWheel = (event) => {
    if (!overlay) return;
    event.preventDefault();
    scale = Math.max(.24, Math.min(1.35, scale * (event.deltaY < 0 ? 1.1 : .9)));
    renderCamera();
  };
  const onKeydown = (event) => {
    if (overlay && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  documentRef.addEventListener('keydown', onKeydown);
  return () => {
    close();
    root.removeEventListener('click', onClick);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('wheel', onWheel);
    documentRef.removeEventListener('keydown', onKeydown);
  };
}
