import * as THREE from "../vendor/three.module.min.js";
import { flattenArchiveOccurrences, tunnelPose, TUNNEL_STEP, TUNNEL_MAX_INDEX } from "./archive-tunnel-data.js";
import { createTunnelState } from "./archive-tunnel-state.js";

const SURFACE_CLASS = "archive-tunnel-surface";
const DESKTOP_TEXTURE_RADIUS = 32;
const MOBILE_TEXTURE_RADIUS = 18;
const MAX_PIXEL_RATIO = 1.6;

function fallbackController(reason, callback) {
  callback?.(reason);
  const snapshot = Object.freeze({ progress: 0, mode: "paused" });
  const no = () => false;
  return Object.freeze({ pause: no, resume: no, startRewind: no, snapshot: () => snapshot, destroy: no });
}

function validSize(root) {
  const width = Number(root?.clientWidth);
  const height = Number(root?.clientHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

function disposeOnce(value, disposed) {
  if (!value || disposed.has(value)) return;
  disposed.add(value);
  value.dispose?.();
}

function setMaterialColor(material, color) {
  if (material.color?.set) material.color.set(color);
  else material.color = color;
}

function safeCall(callback) {
  try { callback?.(); } catch (_error) { /* Cleanup must continue after a hostile DOM or driver failure. */ }
}

/** Mounts an ordered, texture-windowed archive tunnel without touching global input. */
export function mountArchiveTunnel(root, data, options = {}) {
  let fellBack = false;
  const fail = (reason) => {
    if (fellBack) return fallbackController(reason, null);
    fellBack = true;
    return fallbackController(reason, options.onFallback);
  };
  if (!root || typeof root.append !== "function") return fail("Archive tunnel needs a mount root.");
  const occurrences = flattenArchiveOccurrences(data);
  if (!occurrences.length || occurrences.length > TUNNEL_MAX_INDEX + 1) return fail("Archive tunnel has no valid occurrences.");
  const windowRef = options.windowRef ?? (typeof window === "undefined" ? null : window);
  if (typeof windowRef?.WebGLRenderingContext !== "function") return fail("WebGL is unavailable for the archive tunnel.");
  const size = validSize(root);
  if (!size) return fail("Archive tunnel root has no usable size.");

  const three = options.three ?? THREE;
  let renderer;
  try {
    renderer = new three.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch (_error) {
    return fail("Archive tunnel renderer could not be created.");
  }
  if (!renderer?.domElement) {
    renderer?.dispose?.();
    return fail("Archive tunnel renderer could not be created.");
  }

  const requestFrame = options.requestFrame ?? windowRef.requestAnimationFrame?.bind(windowRef);
  const cancelFrame = options.cancelFrame ?? windowRef.cancelAnimationFrame?.bind(windowRef);
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    renderer.dispose?.();
    return fail("Animation frames are unavailable for the archive tunnel.");
  }

  let destroyed = false;
  let frame = null;
  let lastFrameTime = null;
  let endedAnnounced = false;
  let addedSurfaceClass = false;
  let activePointer = null;
  let dragStart = null;
  let dragged = false;
  let loadVersion = 0;
  const disposed = new Set();
  const desiredTextures = new Set();
  const loadedTextures = new Map();
  const loading = new Set();
  const failed = new Set();
  const state = (options.stateFactory ?? createTunnelState)({ maxProgress: occurrences.length - 1 });
  const scene = new three.Scene();
  scene.fog = new three.FogExp2(0x09070c, 0.032);
  const camera = new three.PerspectiveCamera(46, size.width / size.height, 0.1, 120);
  const geometry = new three.PlaneGeometry(1.82, 1.24);
  const loader = new three.TextureLoader();
  const cards = occurrences.map((occurrence, index) => {
    const material = new three.MeshBasicMaterial({ color: 0x1a1521, transparent: true, opacity: 1, side: three.DoubleSide });
    const mesh = new three.Mesh(geometry, material);
    const pose = tunnelPose(index);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.rotation.z = pose.rotationZ;
    scene.add(mesh);
    return { occurrence, mesh, material, texture: null };
  });

  function pixelRatio() {
    return Math.min(MAX_PIXEL_RATIO, Math.max(1, Number(windowRef.devicePixelRatio) || 1));
  }
  function resize() {
    if (destroyed) return;
    const next = validSize(root);
    if (!next) return;
    camera.aspect = next.width / next.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(next.width, next.height);
  }
  resize();
  addedSurfaceClass = !root.classList?.contains?.(SURFACE_CLASS);
  if (addedSurfaceClass) root.classList?.add(SURFACE_CLASS);
  root.append(renderer.domElement);

  function textureRadius() {
    if (Number.isFinite(options.textureRadius)) return Math.max(0, Math.floor(options.textureRadius));
    return windowRef.matchMedia?.("(max-width: 760px)")?.matches ? MOBILE_TEXTURE_RADIUS : DESKTOP_TEXTURE_RADIUS;
  }
  function unload(index) {
    const card = cards[index];
    const texture = loadedTextures.get(index);
    if (texture) disposeOnce(texture, disposed);
    loadedTextures.delete(index);
    card.texture = null;
    card.material.map = null;
    setMaterialColor(card.material, 0x1a1521);
    card.material.needsUpdate = true;
  }
  function load(index) {
    if (loading.has(index) || loadedTextures.has(index) || failed.has(index)) return;
    loading.add(index);
    const generation = loadVersion;
    try {
      loader.load(cards[index].occurrence.src, (texture) => {
        loading.delete(index);
        if (destroyed || generation !== loadVersion || !desiredTextures.has(index)) {
          disposeOnce(texture, disposed);
          return;
        }
        texture.colorSpace = three.SRGBColorSpace;
        cards[index].texture = texture;
        loadedTextures.set(index, texture);
        cards[index].material.map = texture;
        setMaterialColor(cards[index].material, 0xffffff);
        cards[index].material.opacity = 1;
        cards[index].material.needsUpdate = true;
      }, undefined, () => {
        loading.delete(index);
        failed.add(index);
      });
    } catch (_error) {
      loading.delete(index);
      failed.add(index);
    }
  }
  function updateTextureWindow(progress) {
    const center = Math.round(progress);
    const radius = textureRadius();
    const next = new Set();
    for (let index = Math.max(0, center - radius); index <= Math.min(cards.length - 1, center + radius); index += 1) next.add(index);
    for (const index of desiredTextures) if (!next.has(index)) { unload(index); failed.delete(index); }
    desiredTextures.clear();
    for (const index of next) { desiredTextures.add(index); load(index); }
  }
  function updateCamera() {
    const { progress } = state.snapshot();
    const z = 3 - (progress * TUNNEL_STEP);
    camera.position.set(0, 0, z);
    camera.lookAt(0, 0, z - 1);
    updateTextureWindow(progress);
  }
  function announceEnd(before, after) {
    if (after.mode !== "ended") endedAnnounced = false;
    if (before.mode !== "ended" && after.mode === "ended" && !endedAnnounced) {
      endedAnnounced = true;
      options.onEnd?.(after);
    }
  }
  function queueFrame() { if (!destroyed && frame === null) frame = requestFrame(renderFrame); }
  function renderFrame(timestamp) {
    frame = null;
    if (destroyed) return;
    const before = state.snapshot();
    const numericTime = Number(timestamp);
    const delta = lastFrameTime === null || !Number.isFinite(numericTime) ? 0 : Math.min(64, Math.max(0, numericTime - lastFrameTime));
    if (Number.isFinite(numericTime)) lastFrameTime = numericTime;
    state.tick(delta);
    const after = state.snapshot();
    announceEnd(before, after);
    if (destroyed) return;
    updateCamera();
    renderer.render(scene, camera);
    queueFrame();
  }
  function nudge(amount) {
    if (destroyed || !Number.isFinite(amount)) return false;
    const before = state.snapshot();
    const changed = state.nudge(amount);
    announceEnd(before, state.snapshot());
    if (changed) updateCamera();
    return changed;
  }
  function onWheel(event) { if (!Number.isFinite(event.deltaY)) return; event.preventDefault?.(); nudge(event.deltaY * 0.012); }
  function onPointerDown(event) {
    if (destroyed || !Number.isFinite(event.clientY)) return;
    activePointer = event.pointerId;
    dragStart = { x: event.clientX, y: event.clientY };
    dragged = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (destroyed || event.pointerId !== activePointer || !dragStart || !Number.isFinite(event.clientY)) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 6) dragged = true;
    if (dy) { nudge(-dy * 0.05); dragStart = { x: event.clientX, y: event.clientY }; }
  }
  function releasePointer(event) {
    if (event.pointerId !== activePointer) return;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
    activePointer = null;
    dragStart = null;
  }
  function onClick(event) {
    if (destroyed || dragged || !three.Raycaster || !three.Vector2) return;
    const rect = renderer.domElement.getBoundingClientRect?.() ?? root.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const raycaster = new three.Raycaster();
    raycaster.setFromCamera(new three.Vector2(x, y), camera);
    const hit = raycaster.intersectObjects(cards.map((card) => card.mesh), false)?.[0]?.object;
    const card = cards.find((candidate) => candidate.mesh === hit);
    if (!card) return;
    state.pause();
    options.onSelect?.(card.occurrence, card.mesh);
  }
  const listeners = [["wheel", onWheel, { passive: false }], ["pointerdown", onPointerDown], ["pointermove", onPointerMove], ["pointerup", releasePointer], ["pointercancel", releasePointer], ["click", onClick]];
  for (const [name, listener, config] of listeners) renderer.domElement.addEventListener(name, listener, config);
  windowRef.addEventListener?.("resize", resize);
  updateCamera();
  renderer.render(scene, camera);
  queueFrame();

  function pause() { return destroyed ? false : state.pause(); }
  function resume() { return destroyed ? false : state.resume(); }
  function startRewind() {
    if (destroyed) return false;
    const changed = state.startRewind();
    if (changed) endedAnnounced = false;
    return changed;
  }
  function snapshot() { return state.snapshot(); }
  function destroy() {
    if (destroyed) return false;
    destroyed = true;
    loadVersion += 1;
    if (frame !== null) { safeCall(() => cancelFrame(frame)); frame = null; }
    for (const [name, listener, config] of listeners) safeCall(() => renderer.domElement.removeEventListener(name, listener, config));
    safeCall(() => windowRef.removeEventListener?.("resize", resize));
    if (activePointer !== null) safeCall(() => renderer.domElement.releasePointerCapture?.(activePointer));
    activePointer = null;
    dragStart = null;
    for (const texture of loadedTextures.values()) safeCall(() => disposeOnce(texture, disposed));
    loadedTextures.clear();
    for (const card of cards) { safeCall(() => scene.remove(card.mesh)); safeCall(() => disposeOnce(card.material, disposed)); }
    safeCall(() => disposeOnce(geometry, disposed));
    safeCall(() => renderer.domElement.parentNode?.removeChild?.(renderer.domElement));
    safeCall(() => disposeOnce(renderer, disposed));
    if (addedSurfaceClass) safeCall(() => root.classList?.remove(SURFACE_CLASS));
    return true;
  }
  return Object.freeze({ pause, resume, startRewind, snapshot, destroy });
}
