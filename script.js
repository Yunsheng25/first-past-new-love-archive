const state = {
  data: null,
  records: [],
  filtered: [],
  visibleIds: new Set(),
  activePhase: "全部",
  activeId: null,
  query: "",
  bounds: null,
  viewBox: null,
  drag: null,
};

const els = {
  statGroups: document.querySelector("#statGroups"),
  statImages: document.querySelector("#statImages"),
  statEdges: document.querySelector("#statEdges"),
  statUncertain: document.querySelector("#statUncertain"),
  searchInput: document.querySelector("#searchInput"),
  phaseTabs: document.querySelector("#phaseTabs"),
  resultCount: document.querySelector("#resultCount"),
  recordList: document.querySelector("#recordList"),
  canvasSvg: document.querySelector("#canvasSvg"),
  fitView: document.querySelector("#fitView"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  detailPhase: document.querySelector("#detailPhase"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSubtitle: document.querySelector("#detailSubtitle"),
  imageStrip: document.querySelector("#imageStrip"),
  metaNode: document.querySelector("#metaNode"),
  metaPosition: document.querySelector("#metaPosition"),
  metaSize: document.querySelector("#metaSize"),
  metaCertainty: document.querySelector("#metaCertainty"),
  promptText: document.querySelector("#promptText"),
  promptLength: document.querySelector("#promptLength"),
  pathList: document.querySelector("#pathList"),
  connectionList: document.querySelector("#connectionList"),
  nearList: document.querySelector("#nearList"),
  rawText: document.querySelector("#rawText"),
  copyPrompt: document.querySelector("#copyPrompt"),
  openMarkdown: document.querySelector("#openMarkdown"),
  imageDialog: document.querySelector("#imageDialog"),
  closeDialog: document.querySelector("#closeDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogCaption: document.querySelector("#dialogCaption"),
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setText(element, value) {
  element.textContent = value;
}

function svgEl(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "href") {
      element.setAttributeNS("http://www.w3.org/1999/xlink", "href", value);
    } else {
      element.setAttribute(key, value);
    }
  }
  return element;
}

function firstLine(value = "") {
  return value.replace(/\s+/g, " ").trim().slice(0, 120) || "无正文提示词";
}

function recordHaystack(record) {
  return [
    record.id,
    record.phase,
    record.prompt,
    record.rawText,
    ...record.images.map((image) => `${image.ref} ${image.originalPath}`),
  ].join(" ").toLowerCase();
}

function phaseColor(phase) {
  if (phase.includes("现实")) return "#277466";
  if (phase.includes("校园")) return "#315f8f";
  if (phase.includes("商场")) return "#9a650f";
  if (phase.includes("婚礼")) return "#b4232a";
  if (phase.includes("医院")) return "#6e4c8f";
  if (phase.includes("梦醒")) return "#5f6368";
  return "#697077";
}

function computeBounds(records) {
  const xs = records.flatMap((record) => [record.x, record.x + record.width]);
  const ys = records.flatMap((record) => [record.y, record.y + record.height]);
  const margin = 420;
  return {
    x: Math.min(...xs) - margin,
    y: Math.min(...ys) - margin,
    width: Math.max(...xs) - Math.min(...xs) + margin * 2,
    height: Math.max(...ys) - Math.min(...ys) + margin * 2,
  };
}

function setViewBox(viewBox) {
  state.viewBox = viewBox;
  els.canvasSvg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
}

function fitView() {
  setViewBox({ ...state.bounds });
}

function zoomAt(scale) {
  const box = state.viewBox;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const next = {
    width: box.width * scale,
    height: box.height * scale,
  };
  next.x = cx - next.width / 2;
  next.y = cy - next.height / 2;
  setViewBox(next);
}

function clientToSvgPoint(event) {
  const rect = els.canvasSvg.getBoundingClientRect();
  return {
    x: state.viewBox.x + ((event.clientX - rect.left) / rect.width) * state.viewBox.width,
    y: state.viewBox.y + ((event.clientY - rect.top) / rect.height) * state.viewBox.height,
  };
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  state.filtered = state.records.filter((record) => {
    const phaseMatch = state.activePhase === "全部" || record.phase === state.activePhase;
    const queryMatch = !query || recordHaystack(record).includes(query);
    return phaseMatch && queryMatch;
  });
  state.visibleIds = new Set(state.filtered.map((record) => record.id));
  if (!state.visibleIds.has(state.activeId)) {
    state.activeId = state.filtered[0]?.id || null;
  }
  renderPhaseTabs();
  renderList();
  renderGraph();
  renderDetail();
}

function renderStats() {
  const summary = state.data.summary;
  setText(els.statGroups, summary.groups);
  setText(els.statImages, summary.imageRefs);
  setText(els.statEdges, summary.edges);
  setText(els.statUncertain, summary.uncertain);
}

function renderPhaseTabs() {
  const phases = ["全部", ...state.data.phases.filter((phase) => state.data.summary.phaseCounts[phase])];
  els.phaseTabs.innerHTML = phases
    .map((phase) => {
      const count = phase === "全部" ? state.records.length : state.data.summary.phaseCounts[phase];
      return `<button type="button" aria-selected="${phase === state.activePhase}" data-phase="${escapeHtml(phase)}"><span>${escapeHtml(phase)}</span><strong>${count}</strong></button>`;
    })
    .join("");
}

function renderList() {
  setText(els.resultCount, state.filtered.length);
  els.recordList.innerHTML = state.filtered
    .map((record) => `
      <li>
        <button type="button" class="${record.id === state.activeId ? "is-active" : ""}" data-id="${record.id}">
          <strong>第 ${record.index} 组｜${escapeHtml(record.phase)}</strong>
          <span>${escapeHtml(record.images.map((image) => image.ref).join(" / "))}</span>
        </button>
      </li>
    `)
    .join("");
}

function edgeKey(connection) {
  return `${connection.fromNode}->${connection.toNode}`;
}

function renderGraph() {
  const byId = new Map(state.records.map((record) => [record.id, record]));
  const edgeMap = new Map();
  for (const record of state.records) {
    for (const connection of record.connections) {
      if (!byId.has(connection.fromNode) || !byId.has(connection.toNode)) continue;
      edgeMap.set(edgeKey(connection), connection);
    }
  }

  els.canvasSvg.replaceChildren();
  const defs = svgEl("defs");
  defs.innerHTML = `
    <marker id="arrow" markerWidth="18" markerHeight="18" refX="17" refY="9" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 18 9 L 0 18 z" fill="rgba(92,86,77,.42)"></path>
    </marker>
  `;
  els.canvasSvg.append(defs);

  const edgeLayer = svgEl("g", { class: "edge-layer" });
  const nodeLayer = svgEl("g", { class: "node-layer" });
  els.canvasSvg.append(edgeLayer, nodeLayer);

  for (const connection of edgeMap.values()) {
    const from = byId.get(connection.fromNode);
    const to = byId.get(connection.toNode);
    const isVisible = state.visibleIds.has(from.id) && state.visibleIds.has(to.id);
    if (!isVisible) continue;
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height / 2;
    const x2 = to.x + to.width / 2;
    const y2 = to.y + to.height / 2;
    const dx = Math.max(180, Math.abs(x2 - x1) * 0.35);
    const active = from.id === state.activeId || to.id === state.activeId;
    const path = svgEl("path", {
      class: `edge-path ${active ? "is-active" : ""}`,
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    });
    edgeLayer.append(path);
  }

  for (const record of state.records) {
    if (!state.visibleIds.has(record.id)) continue;
    const group = svgEl("g", {
      class: `node-card ${record.id === state.activeId ? "is-active" : ""}`,
      transform: `translate(${record.x}, ${record.y})`,
      "data-id": record.id,
      tabindex: "0",
      role: "button",
    });

    const color = phaseColor(record.phase);
    const rect = svgEl("rect", {
      class: "node-bg",
      x: 0,
      y: 0,
      width: record.width,
      height: record.height,
      rx: 26,
    });
    const stripe = svgEl("rect", {
      x: 0,
      y: 0,
      width: 18,
      height: record.height,
      rx: 8,
      fill: color,
    });
    const thumbWidth = Math.min(220, record.width * 0.34);
    const thumbHeight = Math.min(156, record.height - 80);
    const thumb = svgEl("image", {
      href: record.images[0]?.src || "",
      x: 44,
      y: 38,
      width: thumbWidth,
      height: thumbHeight,
      preserveAspectRatio: "xMidYMid slice",
    });
    const index = svgEl("text", { class: "node-index", x: thumbWidth + 74, y: 88 });
    index.textContent = `#${record.index}`;
    const phase = svgEl("text", { class: "node-phase", x: thumbWidth + 74, y: 134 });
    phase.textContent = record.phase;
    const caption = svgEl("text", { class: "node-caption", x: thumbWidth + 74, y: 180 });
    caption.textContent = `${record.images.length} 图｜${record.prompt ? firstLine(record.prompt).slice(0, 32) : "无正文提示词"}`;
    const nodeId = svgEl("text", { class: "node-caption", x: 44, y: record.height - 34 });
    nodeId.textContent = `x=${record.x}, y=${record.y}｜${record.id}`;
    group.append(rect, stripe, thumb, index, phase, caption, nodeId);
    nodeLayer.append(group);
  }
}

function renderListItems(items, emptyText) {
  return items.length
    ? items.map((item) => `<li>${item}</li>`).join("")
    : `<li>${escapeHtml(emptyText)}</li>`;
}

function renderDetail() {
  const record = state.records.find((item) => item.id === state.activeId);
  if (!record) {
    setText(els.detailTitle, "没有匹配结果");
    setText(els.detailSubtitle, "请调整搜索或阶段筛选。");
    els.imageStrip.innerHTML = "";
    setText(els.promptText, "");
    setText(els.rawText, "");
    return;
  }

  setText(els.detailPhase, record.phase);
  setText(els.detailTitle, `第 ${record.index} 组`);
  setText(els.detailSubtitle, record.images.map((image) => image.ref).join(" / "));
  setText(els.metaNode, record.id);
  setText(els.metaPosition, `x=${record.x}, y=${record.y}`);
  setText(els.metaSize, `${record.width} × ${record.height}`);
  setText(els.metaCertainty, record.uncertain ? "不确定配对" : "同节点配对");
  setText(els.promptText, record.prompt || "该节点没有图片嵌入之外的提示词文字；请人工检查。");
  setText(els.promptLength, `${record.prompt.length} 字`);
  setText(els.rawText, record.rawText);

  els.imageStrip.innerHTML = record.images
    .map((image, index) => `
      <figure class="image-tile">
        <button type="button" data-image="${escapeHtml(image.src)}" data-caption="${escapeHtml(image.ref)}">
          <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.ref)}" loading="lazy" />
        </button>
        <figcaption>图 ${index + 1}：${escapeHtml(image.ref)}</figcaption>
      </figure>
    `)
    .join("");

  els.pathList.innerHTML = renderListItems(
    record.images.map((image, index) => escapeHtml(`图 ${index + 1}：${image.originalPath || image.ref}`)),
    "没有解析到图片路径",
  );
  els.connectionList.innerHTML = renderListItems(
    record.connections.map((edge) => escapeHtml(
      `${edge.direction} ${edge.id}：${edge.fromNode} -> ${edge.toNode}（${edge.fromSide} -> ${edge.toSide}），对方首图：${edge.otherFirstImage || "无"}`,
    )),
    "无连接线",
  );
  els.nearList.innerHTML = renderListItems(
    record.nearest.map((near) => escapeHtml(
      `距离约 ${near.distance}：节点 ${near.id}，x=${near.x}, y=${near.y}，首图：${near.firstImage || "无"}`,
    )),
    "无近邻数据",
  );
}

function selectRecord(id, focusNode = false) {
  state.activeId = id;
  renderList();
  renderGraph();
  renderDetail();
  if (focusNode) centerOnRecord(id);
}

function centerOnRecord(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  const box = state.viewBox;
  setViewBox({
    x: record.x + record.width / 2 - box.width / 2,
    y: record.y + record.height / 2 - box.height / 2,
    width: box.width,
    height: box.height,
  });
}

async function copyActivePrompt() {
  const record = state.records.find((item) => item.id === state.activeId);
  if (!record) return;
  const text = record.prompt || record.rawText;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = els.copyPrompt.textContent;
  els.copyPrompt.textContent = "已复制";
  window.setTimeout(() => {
    els.copyPrompt.textContent = original;
  }, 1200);
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    applyFilters();
  });

  els.phaseTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-phase]");
    if (!button) return;
    state.activePhase = button.dataset.phase;
    applyFilters();
  });

  els.recordList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    selectRecord(button.dataset.id, true);
  });

  els.canvasSvg.addEventListener("click", (event) => {
    const node = event.target.closest(".node-card");
    if (!node) return;
    selectRecord(node.dataset.id, false);
  });

  els.canvasSvg.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const node = event.target.closest(".node-card");
    if (!node) return;
    event.preventDefault();
    selectRecord(node.dataset.id, false);
  });

  els.canvasSvg.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".node-card")) return;
    els.canvasSvg.setPointerCapture(event.pointerId);
    els.canvasSvg.classList.add("is-dragging");
    state.drag = { start: clientToSvgPoint(event), box: { ...state.viewBox } };
  });

  els.canvasSvg.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    const point = clientToSvgPoint(event);
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    setViewBox({
      ...state.drag.box,
      x: state.drag.box.x - dx,
      y: state.drag.box.y - dy,
    });
  });

  els.canvasSvg.addEventListener("pointerup", () => {
    state.drag = null;
    els.canvasSvg.classList.remove("is-dragging");
  });

  els.canvasSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 1.12 : 0.88);
  }, { passive: false });

  els.imageStrip.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-image]");
    if (!button) return;
    els.dialogImage.src = button.dataset.image;
    els.dialogImage.alt = button.dataset.caption;
    setText(els.dialogCaption, button.dataset.caption);
    els.imageDialog.showModal();
  });

  els.fitView.addEventListener("click", fitView);
  els.zoomIn.addEventListener("click", () => zoomAt(0.82));
  els.zoomOut.addEventListener("click", () => zoomAt(1.18));
  els.closeDialog.addEventListener("click", () => els.imageDialog.close());
  els.copyPrompt.addEventListener("click", copyActivePrompt);
  els.openMarkdown.addEventListener("click", () => {
    window.open("output/初恋旧爱新欢_图片提示词整理.md", "_blank");
  });
}

async function init() {
  bindEvents();
  if (window.CANVAS_ARCHIVE_DATA) {
    state.data = window.CANVAS_ARCHIVE_DATA;
  } else {
    const response = await fetch("canvas-data.json");
    state.data = await response.json();
  }
  state.records = state.data.records;
  state.activeId = state.records[0]?.id || null;
  state.bounds = computeBounds(state.records);
  fitView();
  renderStats();
  applyFilters();
}

init().catch((error) => {
  setText(els.detailTitle, "数据载入失败");
  setText(els.promptText, String(error));
});
