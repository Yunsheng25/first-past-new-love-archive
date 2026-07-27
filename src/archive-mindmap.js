import {
  buildCategorizedMindmapRecords,
  buildMindmapGraph,
  getExpandableChildren,
  edgeKind,
} from './archive-mindmap-model.js';
import { fitBounds, restoreReadingView } from './mindmap-camera.js';
import { mountMindmapAmbient } from './mindmap-ambient.js';

const WORLD_WIDTH = 42000;
const WORLD_HEIGHT = 5000;
const ROOT_BOX = Object.freeze({ x: 350, y: 1580, width: 220, height: 220 });

export function symmetricChildBoxes(parentBox, children = []) {
  const step = 300;
  const center = parentBox.y + parentBox.height / 2;
  const horizontalGap = parentBox.width === ROOT_BOX.width ? 190 : 144;
  return children.map((child, index) => {
    const offset = (index - (children.length - 1) / 2) * step;
    return {
      id: child.id,
      x: parentBox.x + parentBox.width + horizontalGap,
      y: center + offset - 93,
      width: 286,
      height: 186,
    };
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function summary(value, length = 68) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function buildMindmapShell(total = 72) {
  return `<section class="archive-mindmap-view archive-index-view app-view" aria-label="提示词和图片制作路径">
    <header class="archive-mindmap-header">
      <a class="archive-wordmark" href="#after">初恋 · 旧爱 · 新欢</a>
      <div class="archive-mindmap-title"><b>提示词和图片</b><span>按白板顺序展开 · ${total} CASES</span></div>
      <div class="archive-mindmap-actions">
        <button type="button" data-archive-view="tunnel">隧道漫游</button>
        <button type="button" data-mindmap-action="overview">当前总览</button>
        <button type="button" data-mindmap-action="restore">恢复原样</button>
        <button type="button" data-mindmap-action="collapse">全部收起</button>
      </div>
    </header>
    <div class="archive-mindmap-viewport" data-mindmap-viewport>
      <div class="archive-mindmap-ambient" data-mindmap-ambient aria-hidden="true"></div>
      <div class="archive-mindmap-world" data-mindmap-world>
        <svg class="archive-mindmap-edges" data-mindmap-edges viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}" aria-hidden="true"></svg>
        <button type="button" class="mindmap-root" data-mindmap-root><b>制作从这里开始</b><small>点击展开真实路径</small><i></i></button>
        <div data-mindmap-nodes></div>
        <div data-mindmap-ends></div>
      </div>
      <p class="archive-mindmap-hint">按真实顺序点击延伸 · 错误支线会回到主线 · 拖动 / 滚轮缩放</p>
      <p class="archive-mindmap-count"><b data-mindmap-count>0 / ${total}</b><span>当前已展开节点</span></p>
    </div>
    <div data-archive-modal-host></div>
    <a class="archive-return-after" href="#after" data-return-after>← 返回片后</a>
  </section>`;
}

export function connectMindmapCases(cases, canvasRecords = []) {
  const caseByNode = new Map(cases.map((item) => [item.source?.nodeId, item]));
  const recordByNode = new Map(canvasRecords.map((item) => [item.id, item]));
  return cases.map((item) => {
    const record = recordByNode.get(item.source?.nodeId);
    const connections = (record?.connections ?? [])
      .filter((connection) => connection.direction === '出线')
      .map((connection) => caseByNode.get(connection.toNode))
      .filter(Boolean)
      .map((target) => ({ direction: '出线', toNode: target.id }));
    return { ...item, connections };
  });
}

export function mountArchiveMindmap(root, {
  cases = [],
  canvasRecords = [],
  onSelectCase = () => {},
  windowRef = globalThis.window,
} = {}) {
  const viewport = root.querySelector('[data-mindmap-viewport]');
  const world = root.querySelector('[data-mindmap-world]');
  const edges = root.querySelector('[data-mindmap-edges]');
  const nodeHost = root.querySelector('[data-mindmap-nodes]');
  const endHost = root.querySelector('[data-mindmap-ends]');
  const rootButton = root.querySelector('[data-mindmap-root]');
  const count = root.querySelector('[data-mindmap-count]');
  if (!viewport || !world || !edges || !nodeHost || !rootButton) return () => {};

  const records = buildCategorizedMindmapRecords(cases);
  const graph = buildMindmapGraph(records);
  const visible = new Map();
  const positions = new Map([['root', ROOT_BOX]]);
  const expanded = new Set();
  const cleanups = [];
  let lastFocused = null;
  let x = 80;
  let y = viewport.clientHeight / 2 - 1690 * 0.72;
  let scale = 0.72;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;

  world.style.width = `${WORLD_WIDTH}px`;
  world.style.height = `${WORLD_HEIGHT}px`;

  const renderCamera = () => {
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  const animateCamera = (camera) => {
    ({ x, y, scale } = camera);
    world.classList.add('is-camera-moving');
    renderCamera();
    windowRef.setTimeout?.(() => world.classList.remove('is-camera-moving'), 720);
  };

  const focus = (record) => {
    const box = positions.get(record.id);
    if (!box) return;
    lastFocused = record;
    animateCamera(restoreReadingView(box, {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }));
  };

  const overview = () => animateCamera(fitBounds(
    [...positions.values()],
    { width: viewport.clientWidth, height: viewport.clientHeight },
    80,
  ));

  const addEdge = (fromId, toId, isBranch = false) => {
    const from = positions.get(fromId);
    const to = positions.get(toId);
    if (!from || !to) return;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const path = edges.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `mindmap-edge${isBranch ? ' is-branch' : ''}`);
    path.setAttribute('d', `M${x1} ${y1} C${x1 + 120} ${y1},${x2 - 120} ${y2},${x2} ${y2}`);
    edges.append(path);
  };

  const createEnd = (record) => {
    const base = positions.get(record.id);
    if (!base || endHost.querySelector(`[data-mindmap-end="${record.id}"]`)) return;
    const id = `end-${record.id}`;
    const box = { x: base.x + 420, y: base.y + 20, width: 230, height: 145 };
    positions.set(id, box);
    const button = endHost.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'mindmap-end';
    button.dataset.mindmapEnd = record.id;
    button.style.left = `${box.x}px`;
    button.style.top = `${box.y}px`;
    button.innerHTML = '<b>回看完整路径</b><small>点击返回当前总览</small>';
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => { event.stopPropagation(); overview(); });
    endHost.append(button);
    addEdge(record.id, id);
  };

  const createNode = (record, box) => {
    if (visible.has(record.id)) return;
    positions.set(record.id, box);
    const firstImage = record.images?.[0];
    const article = nodeHost.ownerDocument.createElement('article');
    article.className = `mindmap-node${record.isCategory ? ' is-category' : ''}${record.status === 'error' ? ' is-error' : ''}`;
    article.dataset.mindmapNode = record.id;
    article.style.left = `${box.x}px`;
    article.style.top = `${box.y}px`;
    article.innerHTML = record.isCategory
      ? ''
      : `${firstImage ? `<img src="${escapeHtml(firstImage.src)}" alt="" loading="lazy" decoding="async">` : ''}
      <div class="mindmap-node-copy">
        <p><span>${escapeHtml(record.stage)}</span><b>${String(record.index).padStart(2, '0')}</b></p>
        <strong>${escapeHtml(record.title)}</strong>
        <small>${escapeHtml(summary(record.prompt))}</small>
        <div><span data-mindmap-expand-label>点击继续延伸 →</span><button type="button" data-mindmap-detail>查看内容</button></div>
      </div><i class="mindmap-node-pulse"></i>`;
    article.addEventListener('click', (event) => {
      if (!record.isCategory && event.target.closest('[data-mindmap-detail]')) {
        event.stopPropagation();
        onSelectCase(record, event.target.closest('[data-mindmap-detail]'));
        return;
      }
      if (expanded.has(record.id)) return;
      expanded.add(record.id);
      article.classList.add('is-expanded');
      const expandLabel = article.querySelector('[data-mindmap-expand-label]');
      if (expandLabel) expandLabel.textContent = '已展开';
      const children = getExpandableChildren(graph, record.id).filter((child) => !visible.has(child.id));
      if (!children.length) {
        createEnd(record);
        return;
      }
      const childBoxes = symmetricChildBoxes(box, children);
      children.forEach((child, index) => {
        const { id: _id, ...childBox } = childBoxes[index];
        createNode(child, childBox);
        addEdge(record.id, child.id, edgeKind(graph, record.id, child.id) !== 'main');
      });
      focus(children[0]);
    });
    nodeHost.append(article);
    visible.set(record.id, article);
    if (count) {
      const visibleCases = [...visible.keys()].filter((id) => !graph.byId.get(id)?.isCategory).length;
      count.textContent = `${visibleCases} / ${cases.length}`;
    }
  };

  const start = () => {
    if (visible.size) return;
    const categories = getExpandableChildren(graph, 'root');
    const categoryBoxes = symmetricChildBoxes(ROOT_BOX, categories);
    categories.forEach((category, index) => {
      const { id: _id, ...box } = categoryBoxes[index];
      createNode(category, box);
      addEdge('root', category.id, true);
    });
    rootButton.classList.add('is-expanded');
    overview();
  };

  const collapse = () => {
    nodeHost.replaceChildren();
    endHost.replaceChildren();
    edges.replaceChildren();
    visible.clear();
    expanded.clear();
    positions.clear();
    positions.set('root', ROOT_BOX);
    lastFocused = null;
    rootButton.classList.remove('is-expanded');
    if (count) count.textContent = `0 / ${cases.length}`;
    scale = 0.72;
    x = 80;
    y = viewport.clientHeight / 2 - 1690 * scale;
    renderCamera();
  };

  const onAction = (event) => {
    const action = event.target.closest('[data-mindmap-action]')?.dataset.mindmapAction;
    if (action === 'overview') overview();
    if (action === 'restore') {
      if (lastFocused) focus(lastFocused);
      else collapse();
    }
    if (action === 'collapse') collapse();
  };
  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('.mindmap-node,.mindmap-root,.mindmap-end,.archive-mindmap-actions')) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    viewport.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    x += event.clientX - pointerX;
    y += event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    renderCamera();
  };
  const onPointerUp = () => { dragging = false; };
  const onWheel = (event) => {
    event.preventDefault();
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(1.25, scale * (event.deltaY < 0 ? 1.1 : 0.9)));
    const rect = viewport.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    x = localX - (localX - x) * (scale / oldScale);
    y = localY - (localY - y) * (scale / oldScale);
    renderCamera();
  };

  rootButton.addEventListener('click', start);
  root.addEventListener('click', onAction);
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  cleanups.push(
    () => rootButton.removeEventListener('click', start),
    () => root.removeEventListener('click', onAction),
    () => viewport.removeEventListener('pointerdown', onPointerDown),
    () => viewport.removeEventListener('pointermove', onPointerMove),
    () => viewport.removeEventListener('pointerup', onPointerUp),
    () => viewport.removeEventListener('pointercancel', onPointerUp),
    () => viewport.removeEventListener('wheel', onWheel),
  );
  cleanups.push(mountMindmapAmbient(viewport, {
    reducedMotion: windowRef.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
  }));
  renderCamera();
  return () => cleanups.splice(0).forEach((cleanup) => cleanup());
}
