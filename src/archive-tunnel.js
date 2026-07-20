import * as THREE from "../vendor/three.module.min.js";
import { flattenArchiveOccurrences, tunnelPose, TUNNEL_STEP, TUNNEL_MAX_INDEX } from "./archive-tunnel-data.js";
import { createTunnelState } from "./archive-tunnel-state.js";

const SURFACE_CLASS = "archive-tunnel-surface";
const DARK_CARD = 0x1a1521;

function safe(callback) { try { return callback?.(); } catch (_error) { return undefined; } }
function dispose(value, seen) { if (value && !seen.has(value)) { seen.add(value); safe(() => value.dispose?.()); } }
function setColor(material, value) { if (material.color?.set) material.color.set(value); else material.color = value; }
function sizeOf(root) { const width = Number(root?.clientWidth); const height = Number(root?.clientHeight); return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null; }
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
  const windowRef = options.windowRef ?? (typeof window === "undefined" ? null : window);
  if (typeof windowRef?.WebGLRenderingContext !== "function") return fallback("webgl-unavailable");
  if (!sizeOf(root)) return fallback("unusable-root");
  const three = options.three ?? THREE;
  let renderer;
  try { renderer = new three.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" }); } catch (_error) { return fallback("renderer-failed"); }
  if (!renderer?.domElement) { safe(() => renderer?.dispose?.()); return fallback("renderer-failed"); }

  const registry = { renderer, canvas: renderer.domElement, scene: null, geometry: null, cards: [], listeners: [], frame: null, classAdded: false, appended: false, destroyed: false, disposed: new Set(), activePointer: null };
  const cancelFrame = options.cancelFrame ?? windowRef.cancelAnimationFrame?.bind(windowRef);
  const requestFrame = options.requestFrame ?? windowRef.requestAnimationFrame?.bind(windowRef);
  const cleanup = () => {
    if (registry.destroyed) return false;
    registry.destroyed = true;
    if (registry.frame !== null) safe(() => cancelFrame?.(registry.frame));
    registry.frame = null;
    for (const item of registry.listeners) safe(() => item.target.removeEventListener(item.name, item.listener, item.config));
    registry.listeners.length = 0;
    safe(() => windowRef.removeEventListener?.("resize", resize));
    if (registry.activePointer !== null) safe(() => registry.canvas.releasePointerCapture?.(registry.activePointer));
    registry.activePointer = null;
    for (const card of registry.cards) {
      card.generation += 1; card.desired = false;
      dispose(card.texture, registry.disposed); card.texture = null;
      safe(() => registry.scene?.remove?.(card.mesh));
      dispose(card.material, registry.disposed);
    }
    dispose(registry.geometry, registry.disposed);
    if (registry.appended) safe(() => registry.canvas.parentNode?.removeChild?.(registry.canvas));
    if (registry.classAdded) safe(() => root.classList?.remove(SURFACE_CLASS));
    dispose(registry.renderer, registry.disposed);
    return true;
  };
  function initializationFailed() { cleanup(); return fallback("initialization-failed"); }
  let resize = () => {};

  try {
    if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") throw new Error("raf unavailable");
    registry.scene = new three.Scene();
    registry.scene.fog = new three.FogExp2(0x09070c, 0.032);
    const initial = sizeOf(root);
    const camera = new three.PerspectiveCamera(46, initial.width / initial.height, 0.1, 120);
    registry.geometry = new three.PlaneGeometry(1.82, 1.24);
    const state = (options.stateFactory ?? createTunnelState)({ maxProgress: occurrences.length - 1 });
    const loader = new three.TextureLoader();
    let previousTime = null;
    let endedAnnounced = false;
    let drag = null;
    let dragged = false;
    const radius = () => Number.isFinite(options.textureRadius) ? Math.max(0, Math.floor(options.textureRadius)) : (windowRef.matchMedia?.("(max-width: 760px)")?.matches ? 18 : 32);
    const dpr = () => Math.min(1.6, Math.max(1, Number(windowRef.devicePixelRatio) || 1));
    registry.cards = occurrences.map((occurrence, index) => {
      const material = new three.MeshBasicMaterial({ color: DARK_CARD, transparent: true, opacity: 1, side: three.DoubleSide });
      const mesh = new three.Mesh(registry.geometry, material);
      const pose = tunnelPose(index);
      mesh.position.set(pose.x, pose.y, pose.z); mesh.rotation.z = pose.rotationZ;
      registry.scene.add(mesh);
      return { occurrence, mesh, material, texture: null, desired: false, failed: false, loading: false, generation: 0 };
    });
    function unload(card) { dispose(card.texture, registry.disposed); card.texture = null; card.material.map = null; setColor(card.material, DARK_CARD); card.material.opacity = 1; card.material.needsUpdate = true; }
    function load(card) {
      if (card.failed || registry.destroyed) return;
      const generation = ++card.generation;
      card.loading = true;
      const success = (texture) => {
        if (registry.destroyed || !card.desired || card.generation !== generation) { dispose(texture, registry.disposed); return; }
        card.loading = false; card.texture = texture; texture.colorSpace = three.SRGBColorSpace;
        card.material.map = texture; setColor(card.material, 0xffffff); card.material.opacity = 1; card.material.needsUpdate = true;
      };
      const failure = () => {
        if (registry.destroyed || !card.desired || card.generation !== generation) return;
        card.loading = false; card.failed = true;
      };
      try { loader.load(card.occurrence.src, success, undefined, failure); } catch (_error) { failure(); }
    }
    function windowTextures(progress) {
      const center = Math.round(progress); const r = radius();
      registry.cards.forEach((card, index) => {
        const wanted = index >= Math.max(0, center - r) && index <= Math.min(registry.cards.length - 1, center + r);
        if (!wanted && card.desired) { card.desired = false; card.generation += 1; card.failed = false; unload(card); }
        if (wanted && !card.desired) { card.desired = true; card.failed = false; load(card); }
      });
    }
    function update() {
      const snap = state.snapshot(); const z = 3 - snap.progress * TUNNEL_STEP;
      camera.position.set(0, 0, z); camera.lookAt(0, 0, z - 1); windowTextures(snap.progress); return snap;
    }
    resize = () => {
      if (registry.destroyed) return;
      const next = sizeOf(root); if (!next) return;
      camera.aspect = next.width / next.height; camera.updateProjectionMatrix();
      renderer.setPixelRatio(dpr()); renderer.setSize(next.width, next.height);
    };
    function end(before, after) {
      if (after.mode !== "ended") endedAnnounced = false;
      if (before.mode !== "ended" && after.mode === "ended" && !endedAnnounced) { endedAnnounced = true; options.onEnd?.(after); }
    }
    function schedule() { if (!registry.destroyed && registry.frame === null) registry.frame = requestFrame(frame); }
    function frame(timestamp) {
      registry.frame = null; if (registry.destroyed) return;
      const before = state.snapshot(); const now = Number(timestamp);
      const delta = previousTime === null || !Number.isFinite(now) ? 0 : Math.min(64, Math.max(0, now - previousTime));
      if (Number.isFinite(now)) previousTime = now;
      state.tick(delta); const after = state.snapshot(); end(before, after); if (registry.destroyed) return;
      update(); renderer.render(registry.scene, camera); schedule();
    }
    function nudge(value) { if (!Number.isFinite(value) || registry.destroyed) return false; const before = state.snapshot(); const changed = state.nudge(value); end(before, state.snapshot()); if (changed) update(); return changed; }
    function wheel(event) { if (!Number.isFinite(event.deltaY)) return; event.preventDefault?.(); nudge(event.deltaY * 0.012); }
    function down(event) { if (registry.destroyed || !Number.isFinite(event.clientY)) return; registry.activePointer = event.pointerId; drag = { x: event.clientX, y: event.clientY }; dragged = false; safe(() => registry.canvas.setPointerCapture?.(event.pointerId)); }
    function move(event) { if (event.pointerId !== registry.activePointer || !drag || !Number.isFinite(event.clientY)) return; const dx = event.clientX - drag.x; const dy = event.clientY - drag.y; if (Math.hypot(dx, dy) > 6) dragged = true; if (dy) { nudge(-dy * 0.05); drag = { x: event.clientX, y: event.clientY }; } }
    function release(event) { if (event.pointerId !== registry.activePointer) return; safe(() => registry.canvas.releasePointerCapture?.(event.pointerId)); registry.activePointer = null; drag = null; }
    function click(event) {
      if (registry.destroyed || dragged || !three.Raycaster || !three.Vector2) return;
      const rect = registry.canvas.getBoundingClientRect?.() ?? root.getBoundingClientRect?.(); if (!rect?.width || !rect?.height) return;
      const ray = new three.Raycaster(); ray.setFromCamera(new three.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const object = ray.intersectObjects(registry.cards.map((card) => card.mesh), false)?.[0]?.object;
      const card = registry.cards.find((item) => item.mesh === object); if (!card) return;
      state.pause(); options.onSelect?.(card.occurrence, card.mesh);
    }
    const listeners = [["wheel", wheel, { passive: false }], ["pointerdown", down], ["pointermove", move], ["pointerup", release], ["pointercancel", release], ["click", click]];
    for (const [name, listener, config] of listeners) { const item = { target: registry.canvas, name, listener, config }; registry.listeners.push(item); registry.canvas.addEventListener(name, listener, config); }
    windowRef.addEventListener?.("resize", resize);
    const already = root.classList?.contains?.(SURFACE_CLASS); if (!already) { root.classList?.add(SURFACE_CLASS); registry.classAdded = true; }
    registry.appended = true; root.append(registry.canvas);
    resize(); update(); renderer.render(registry.scene, camera); schedule();
    return Object.freeze({ pause: () => registry.destroyed ? false : state.pause(), resume: () => registry.destroyed ? false : state.resume(), startRewind: () => { if (registry.destroyed) return false; const changed = state.startRewind(); if (changed) endedAnnounced = false; return changed; }, snapshot: () => state.snapshot(), destroy: cleanup });
  } catch (_error) { return initializationFailed(); }
}
