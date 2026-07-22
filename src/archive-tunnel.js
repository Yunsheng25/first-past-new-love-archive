import {
  APPROVED_TUNNEL_CAMERA_END,
  APPROVED_TUNNEL_CAMERA_START,
  TUNNEL_MAX_INDEX,
  approvedTunnelPose,
  flattenArchiveOccurrences,
} from "./archive-tunnel-data.js";
import { createTunnelState } from "./archive-tunnel-state.js";

const SURFACE_CLASS = "archive-tunnel-surface";

function safe(callback) { try { return callback?.(); } catch (_error) { return undefined; } }
function sizeOf(root) {
  const width = Number(root?.clientWidth);
  const height = Number(root?.clientHeight);
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}
function noop(reason, onFallback) {
  safe(() => onFallback?.(reason));
  const snap = Object.freeze({ progress: 0, mode: "paused" });
  const no = () => false;
  return Object.freeze({ pause: no, resume: no, startRewind: no, snapshot: () => snap, destroy: no });
}

export function mountArchiveTunnel(root, data, options = {}) {
  let fallbackCalled = false;
  const fallback = (reason) => {
    if (fallbackCalled) return noop(reason);
    fallbackCalled = true;
    return noop(reason, options.onFallback);
  };
  if (!root || typeof root.append !== "function") return fallback("missing-root");
  const occurrences = flattenArchiveOccurrences(data);
  if (!occurrences.length || occurrences.length > TUNNEL_MAX_INDEX + 1) return fallback("invalid-data");
  const initialSize = sizeOf(root);
  if (!initialSize) return fallback("unusable-root");
  let windowRef; let documentRef; let requestFrame; let cancelFrame;
  try {
    windowRef = options.windowRef ?? (typeof window === "undefined" ? null : window);
    documentRef = options.documentRef ?? root.ownerDocument ?? (typeof document === "undefined" ? null : document);
    requestFrame = options.requestFrame ?? windowRef?.requestAnimationFrame?.bind(windowRef);
    cancelFrame = options.cancelFrame ?? windowRef?.cancelAnimationFrame?.bind(windowRef);
  } catch (_error) { return fallback("initialization-failed"); }
  if (!documentRef?.createElement || typeof requestFrame !== "function" || typeof cancelFrame !== "function") return fallback("dom-unavailable");

  const registry = { destroyed: false, appended: false, classAdded: false, frame: null, frameToken: 0, listeners: [], activePointer: null };
  let state;
  let layer;
  const cards = [];
  let previousTime = null;
  let endedAnnounced = false;
  let drag = null;
  let dragged = false;

  function isMoving(snapshot) { return snapshot.mode === "cruising" || snapshot.mode === "rewinding"; }
  function stopFrame() {
    registry.frameToken += 1;
    if (registry.frame !== null) safe(() => cancelFrame(registry.frame));
    registry.frame = null;
  }
  function announceEnd(before, after) {
    if (after.mode !== "ended") endedAnnounced = false;
    if (before.mode !== "ended" && after.mode === "ended" && !endedAnnounced) {
      endedAnnounced = true;
      safe(() => options.onEnd?.(after));
    }
  }
  function cameraPosition(progress) {
    const denominator = Math.max(1, occurrences.length - 1);
    return APPROVED_TUNNEL_CAMERA_START
      + (APPROVED_TUNNEL_CAMERA_END - APPROVED_TUNNEL_CAMERA_START) * (progress / denominator);
  }
  function render() {
    if (registry.destroyed) return false;
    const viewport = sizeOf(root);
    if (!viewport) return false;
    const snapshot = state.snapshot();
    const camera = { ...viewport, position: cameraPosition(snapshot.progress) };
    cards.forEach(({ card }, index) => {
      const pose = approvedTunnelPose(index, camera);
      card.hidden = !pose.visible;
      card.style.opacity = pose.visible ? String(pose.opacity) : "0";
      card.style.zIndex = String(pose.zIndex);
      card.style.transform = `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`;
    });
    safe(() => options.onProgress?.(snapshot));
    return true;
  }
  function schedule(restart = false) {
    if (registry.destroyed || registry.frame !== null || !isMoving(state.snapshot())) return false;
    if (restart) previousTime = null;
    const token = ++registry.frameToken;
    registry.frame = requestFrame((timestamp) => {
      if (registry.destroyed || token !== registry.frameToken) return;
      frame(timestamp);
    });
    return true;
  }
  function frame(timestamp) {
    registry.frame = null;
    if (registry.destroyed) return;
    try {
      const before = state.snapshot();
      const now = Number(timestamp);
      const delta = previousTime === null || !Number.isFinite(now) ? 0 : Math.min(64, Math.max(0, now - previousTime));
      if (Number.isFinite(now)) previousTime = now;
      state.tick(delta);
      const after = state.snapshot();
      announceEnd(before, after);
      if (registry.destroyed) return;
      render();
      if (isMoving(after)) schedule();
    } catch (_error) { cleanup(); }
  }
  function nudge(value) {
    if (!Number.isFinite(value) || registry.destroyed) return false;
    try {
      const before = state.snapshot();
      const changed = state.nudge(value);
      const after = state.snapshot();
      announceEnd(before, after);
      if (registry.destroyed) return false;
      if (!isMoving(after)) stopFrame();
      if (changed) render(); else if (isMoving(after)) schedule();
      return changed;
    } catch (_error) { cleanup(); return false; }
  }
  function wheel(event) {
    if (registry.destroyed || !Number.isFinite(event.deltaY)) return;
    event.preventDefault?.();
    nudge(event.deltaY * 0.012);
  }
  function down(event) {
    if (registry.destroyed || !Number.isFinite(event.clientY) || event.target?.closest?.(".archive-tunnel-card")) return;
    registry.activePointer = event.pointerId;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastY: event.clientY, dragged: false };
    dragged = false;
    safe(() => root.setPointerCapture?.(event.pointerId));
  }
  function move(event) {
    if (registry.destroyed || event.pointerId !== registry.activePointer || !drag || !Number.isFinite(event.clientY)) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.dragged = true;
    dragged = drag.dragged;
    const stepY = event.clientY - drag.lastY;
    if (stepY) { nudge(-stepY * 0.05); drag.lastY = event.clientY; }
  }
  function release(event) {
    if (registry.destroyed || event.pointerId !== registry.activePointer) return;
    safe(() => root.releasePointerCapture?.(event.pointerId));
    registry.activePointer = null;
    drag = null;
  }
  function clearDragSuppression() { if (dragged) dragged = false; }
  function resize() { if (!registry.destroyed) { try { render(); } catch (_error) { cleanup(); } } }
  function on(target, name, listener, config) {
    target.addEventListener?.(name, listener, config);
    registry.listeners.push({ target, name, listener, config });
  }
  function cleanup() {
    if (registry.destroyed) return false;
    registry.destroyed = true;
    stopFrame();
    registry.listeners.forEach(({ target, name, listener, config }) => safe(() => target.removeEventListener?.(name, listener, config)));
    registry.listeners.length = 0;
    if (registry.activePointer !== null) safe(() => root.releasePointerCapture?.(registry.activePointer));
    registry.activePointer = null;
    cards.forEach(({ image }) => safe(() => { image.src = ""; }));
    if (registry.appended) safe(() => layer?.remove?.() ?? layer?.parentNode?.removeChild?.(layer));
    if (registry.classAdded) safe(() => root.classList?.remove(SURFACE_CLASS));
    return true;
  }

  try {
    state = (options.stateFactory ?? createTunnelState)({ maxProgress: occurrences.length - 1 });
    if (Number.isFinite(options.initialProgress) && options.initialProgress > 0) {
      state.nudge(options.initialProgress);
      state.resume();
    }
    layer = documentRef.createElement("div");
    layer.className = "archive-tunnel-card-layer";
    layer.setAttribute?.("aria-live", "off");
    occurrences.forEach((occurrence, index) => {
      const card = documentRef.createElement("button");
      card.type = "button";
      const ratioClass = index % 5 === 0 ? "portrait" : index % 3 === 0 ? "tall" : "landscape";
      card.className = `archive-tunnel-card archive-tunnel-card--${ratioClass}`;
      card.dataset.order = String(occurrence.order);
      card.dataset.status = occurrence.status;
      card.setAttribute?.("aria-label", `${occurrence.title} · ${occurrence.role ?? "案例图片"}`);
      const image = documentRef.createElement("img");
      image.src = occurrence.src;
      image.alt = `${occurrence.title} · ${occurrence.role ?? "案例图片"}`;
      image.loading = index > 48 ? "lazy" : "eager";
      image.decoding = "async";
      card.append(image);
      if (occurrence.status === "error") {
        const badge = documentRef.createElement("span");
        badge.className = "archive-tunnel-card-error";
        badge.textContent = "错误尝试";
        card.append(badge);
      }
      layer.append(card);
      cards.push({ card, image, occurrence, click: null });
    });
    cards.forEach((entry) => {
      entry.click = () => {
        if (registry.destroyed || dragged || state.snapshot().mode === "rewinding") return;
        state.pause(); stopFrame(); safe(() => options.onSelect?.(entry.occurrence, entry.card));
      };
      on(entry.card, "click", entry.click);
    });
    on(root, "wheel", wheel, { passive: false });
    on(root, "pointerdown", down);
    on(root, "pointermove", move);
    on(root, "pointerup", release);
    on(root, "pointercancel", release);
    on(root, "click", clearDragSuppression);
    on(windowRef, "resize", resize);
    if (!root.classList?.contains?.(SURFACE_CLASS)) { root.classList?.add(SURFACE_CLASS); registry.classAdded = true; }
    root.append(layer); registry.appended = true;
    render(); schedule();
  } catch (_error) {
    cleanup();
    return fallback("initialization-failed");
  }

  return Object.freeze({
    pause: () => { if (registry.destroyed) return false; const changed = state.pause(); if (changed) stopFrame(); return changed; },
    resume: () => { if (registry.destroyed) return false; const changed = state.resume(); if (changed) schedule(true); return changed; },
    startRewind: () => { if (registry.destroyed) return false; const changed = state.startRewind(); if (changed) { endedAnnounced = false; schedule(true); } return changed; },
    snapshot: () => state.snapshot(),
    destroy: cleanup,
  });
}
