import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import archiveData from "../data/archive.json" with { type: "json" };
import {
  TUNNEL_RADIUS_X,
  TUNNEL_RADIUS_Y,
  TUNNEL_MAX_INDEX,
  TUNNEL_STEP,
  flattenArchiveOccurrences,
  groupCaseImages,
  tunnelPose,
} from "../src/archive-tunnel-data.js";
import {
  TUNNEL_CRUISE_MS,
  TUNNEL_REWIND_MS,
  createTunnelState,
} from "../src/archive-tunnel-state.js";
import { mountArchiveTunnel } from "../src/archive-tunnel.js";

const flatSignature = (items) => items.map(({ order, caseId, role, src }) => [order, caseId, role, src]);

test("flattens every authored archive image into its immutable tunnel occurrence", () => {
  const items = flattenArchiveOccurrences(archiveData);

  assert.equal(items.length, 138);
  assert.equal(new Set(items.map((item) => item.src)).size, 137);
  assert.deepEqual(items.map((item) => item.order), Array.from({ length: 138 }, (_, index) => index + 1));
  assert.deepEqual(items[0], {
    order: 1,
    caseId: "case-01",
    caseIndex: 0,
    imageIndex: 0,
    title: archiveData.cases[0].title,
    role: archiveData.cases[0].images[0].role,
    src: archiveData.cases[0].images[0].src,
  });
  assert.deepEqual(items.at(-1), {
    order: 138,
    caseId: "case-72",
    caseIndex: 71,
    imageIndex: 0,
    title: archiveData.cases.at(-1).title,
    role: archiveData.cases.at(-1).images[0].role,
    src: archiveData.cases.at(-1).images[0].src,
  });
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(flatSignature(items))).digest("hex"),
    "196ef58e605fa5de25c68cbf6e4bf285d924dde18d8d515f93f1032948e14bd8",
  );
});

test("flattening retains duplicate sources at their authored occurrences without retaining source references", () => {
  const source = structuredClone(archiveData);
  const items = flattenArchiveOccurrences(source);
  const duplicateSource = "assets/canvas-images/038-18.png";
  const matches = items.filter((item) => item.src === duplicateSource);

  assert.deepEqual(matches.map(({ order, caseId, role }) => ({ order, caseId, role })), [
    { order: 38, caseId: "case-21", role: "尾帧" },
    { order: 39, caseId: "case-22", role: "首帧" },
  ]);
  assert.ok(Object.isFrozen(items));
  assert.ok(items.every(Object.isFrozen));
  assert.throws(() => { items.push({}); }, TypeError);
  assert.throws(() => { items[0].title = "changed"; }, TypeError);
  const title = items[0].title;
  source.cases[0].title = "source mutation";
  assert.equal(items[0].title, title);
});

test("groups exact case images in their authored order as immutable copies", () => {
  const expected = archiveData.cases.find((item) => item.id === "case-03").images;
  const images = groupCaseImages(archiveData, "case-03");

  assert.deepEqual(images, expected);
  assert.notStrictEqual(images, expected);
  assert.ok(Object.isFrozen(images));
  assert.ok(images.every(Object.isFrozen));
  assert.throws(() => { images.push({}); }, TypeError);
  assert.throws(() => { images[0].src = "changed"; }, TypeError);
  assert.deepEqual(groupCaseImages(archiveData, "not-a-case"), []);
  assert.ok(Object.isFrozen(groupCaseImages(archiveData, "not-a-case")));
});

test("archive group sizes and every two-image role order match the authored source", () => {
  const histogram = archiveData.cases.reduce((counts, item) => {
    counts[item.images.length] = (counts[item.images.length] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(histogram, { 1: 13, 2: 58, 9: 1 });

  for (const item of archiveData.cases.filter((candidate) => candidate.images.length === 2)) {
    const group = groupCaseImages(archiveData, item.id);
    assert.deepEqual(group.map((image) => image.role), item.images.map((image) => image.role), item.id);
    assert.deepEqual(group.map((image) => image.src), item.images.map((image) => image.src), item.id);
  }
});

test("empty and malformed archive input produces immutable empty results", () => {
  for (const data of [null, undefined, {}, { cases: null }, { cases: "not-an-array" }]) {
    const flattened = flattenArchiveOccurrences(data);
    assert.deepEqual(flattened, []);
    assert.ok(Object.isFrozen(flattened));
    const grouped = groupCaseImages(data, "case-01");
    assert.deepEqual(grouped, []);
    assert.ok(Object.isFrozen(grouped));
  }
});

test("maps the full supported tunnel domain to deterministic, bounded spiral poses", () => {
  assert.ok(TUNNEL_STEP > 0);
  assert.ok(TUNNEL_RADIUS_X > 0);
  assert.ok(TUNNEL_RADIUS_Y > 0);
  assert.equal(TUNNEL_MAX_INDEX, 137);
  const poses = Array.from({ length: TUNNEL_MAX_INDEX + 1 }, (_, index) => tunnelPose(index));
  const [start, , , , , , , , near] = poses;
  const far = poses.at(-1);

  assert.deepEqual(tunnelPose(8), near);
  for (const pose of poses) {
    assert.deepEqual(Object.keys(pose), ["x", "y", "z", "rotationZ"]);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(Math.abs(pose.x) <= TUNNEL_RADIUS_X);
    assert.ok(Math.abs(pose.y) <= TUNNEL_RADIUS_Y);
  }
  assert.equal(start.z, 0);
  assert.equal(near.z, -8 * TUNNEL_STEP);
  assert.equal(far.z, -137 * TUNNEL_STEP);
  assert.ok(far.z < near.z && near.z < start.z);
  for (let index = 1; index < poses.length; index += 1) {
    assert.ok(Math.abs((poses[index].z - poses[index - 1].z) + TUNNEL_STEP) < 1e-12);
    assert.ok(poses[index].z < poses[index - 1].z);
  }
});

test("aligns the Three plane local x-axis to the true ellipse tangent", () => {
  const tolerance = 1e-12;
  assert.ok(Math.abs(tunnelPose(0).rotationZ - (Math.PI / 2)) < tolerance);
  for (const index of [1, 3, 8, 17]) {
    const pose = tunnelPose(index);
    const ellipseNormal = { x: pose.x / (TUNNEL_RADIUS_X ** 2), y: pose.y / (TUNNEL_RADIUS_Y ** 2) };
    const cardLongAxis = { x: Math.cos(pose.rotationZ), y: Math.sin(pose.rotationZ) };
    const dotProduct = (ellipseNormal.x * cardLongAxis.x) + (ellipseNormal.y * cardLongAxis.y);
    assert.ok(Math.abs(dotProduct) < tolerance, `index ${index} must be tangent to the ellipse`);
  }
});

test("keeps the final supported tunnel pose finite", () => {
  const pose = tunnelPose(TUNNEL_MAX_INDEX);
  assert.ok(Number.isFinite(pose.x));
  assert.ok(Number.isFinite(pose.y));
  assert.ok(Number.isFinite(pose.z));
  assert.ok(Number.isFinite(pose.rotationZ));
  assert.deepEqual(tunnelPose(TUNNEL_MAX_INDEX), pose);
});

test("rejects indexes outside the supported archive tunnel domain", () => {
  for (const index of [-1, 1.5, NaN, Infinity, 138, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, "1", null]) {
    assert.throws(() => tunnelPose(index), RangeError);
  }
});

test("cruises to the exact end over 90 seconds independently of tick partitioning", () => {
  assert.equal(TUNNEL_CRUISE_MS, 90000);
  const oneTick = createTunnelState({ maxProgress: 137 });
  assert.equal(oneTick.tick(90000), true);
  assert.deepEqual(oneTick.snapshot(), { progress: 137, mode: "ended" });

  const partitioned = createTunnelState({ maxProgress: 137 });
  for (const delta of [17, 186, 4321, 25000, 17, 60459]) partitioned.tick(delta);
  assert.deepEqual(partitioned.snapshot(), oneTick.snapshot());
  assert.equal(partitioned.tick(1), false);
});

test("derives each cruise segment from elapsed time without partition drift", () => {
  const oneTick = createTunnelState({ maxProgress: 137 });
  oneTick.tick(TUNNEL_CRUISE_MS);

  const partitionsToCheck = [
    [86275, 656, 3069],
    Array.from({ length: 89 }, (_, index) => index + 1).concat(85995),
  ];
  for (let seed = 1; seed <= 24; seed += 1) {
    let remaining = TUNNEL_CRUISE_MS;
    const partitions = [];
    let state = seed;
    while (remaining > 0) {
      state = (state * 48271) % 2147483647;
      const delta = Math.min(remaining, 1 + (state % 3000));
      partitions.push(delta);
      remaining -= delta;
    }
    partitionsToCheck.push(partitions);
  }
  for (const partitions of partitionsToCheck) {
    const state = createTunnelState({ maxProgress: 137 });
    for (const delta of partitions) state.tick(delta);
    assert.deepEqual(state.snapshot(), oneTick.snapshot());
  }

  const nearEnd = createTunnelState({ maxProgress: 137 });
  nearEnd.tick(89999);
  assert.equal(nearEnd.snapshot().mode, "cruising");
  nearEnd.tick(1);
  assert.deepEqual(nearEnd.snapshot(), { progress: 137, mode: "ended" });

  const resumed = createTunnelState({ maxProgress: 100 });
  resumed.nudge(50);
  resumed.resume();
  resumed.tick(45000);
  assert.deepEqual(resumed.snapshot(), { progress: 100, mode: "ended" });
});

test("preserves cruise elapsed time across pauses and only rebases after a manual nudge", () => {
  const oneTick = createTunnelState({ maxProgress: 137 });
  oneTick.tick(TUNNEL_CRUISE_MS);

  const reproduced = createTunnelState({ maxProgress: 137 });
  reproduced.tick(2);
  reproduced.pause();
  assert.equal(reproduced.tick(5000), false);
  reproduced.resume();
  reproduced.tick(89998);
  assert.deepEqual(reproduced.snapshot(), oneTick.snapshot());

  const partitions = Array.from({ length: 99 }, (_, index) => index + 1).concat(85050);
  const pausedBetweenTicks = createTunnelState({ maxProgress: 137 });
  for (let index = 0; index < partitions.length; index += 1) {
    pausedBetweenTicks.tick(partitions[index]);
    if (index < partitions.length - 1) {
      assert.equal(pausedBetweenTicks.pause(), true);
      assert.equal(pausedBetweenTicks.tick(1234), false);
      assert.equal(pausedBetweenTicks.resume(), true);
    }
  }
  assert.deepEqual(pausedBetweenTicks.snapshot(), oneTick.snapshot());

  const manuallyRebased = createTunnelState({ maxProgress: 100 });
  manuallyRebased.tick(9000);
  manuallyRebased.nudge(40);
  manuallyRebased.resume();
  manuallyRebased.tick(45000);
  assert.deepEqual(manuallyRebased.snapshot(), { progress: 100, mode: "ended" });
});

test("rewinds from the end with a symmetric cubic ease and stops exactly at the entrance", () => {
  assert.equal(TUNNEL_REWIND_MS, 3200);
  const state = createTunnelState({ maxProgress: 137 });
  state.tick(TUNNEL_CRUISE_MS);
  assert.equal(state.startRewind(), true);
  assert.deepEqual(state.snapshot(), { progress: 137, mode: "rewinding" });
  state.tick(TUNNEL_REWIND_MS / 2);
  assert.deepEqual(state.snapshot(), { progress: 68.5, mode: "rewinding" });
  state.tick(TUNNEL_REWIND_MS / 2);
  assert.deepEqual(state.snapshot(), { progress: 0, mode: "paused" });

  const largeTick = createTunnelState({ maxProgress: 137 });
  largeTick.tick(TUNNEL_CRUISE_MS);
  largeTick.startRewind();
  largeTick.tick(TUNNEL_REWIND_MS * 2);
  assert.deepEqual(largeTick.snapshot(), { progress: 0, mode: "paused" });
});

test("rebases cruise timing at the entrance after a completed rewind", () => {
  const state = createTunnelState({ maxProgress: 137 });
  state.tick(TUNNEL_CRUISE_MS);
  state.startRewind();
  state.tick(TUNNEL_REWIND_MS * 2);
  assert.deepEqual(state.snapshot(), { progress: 0, mode: "paused" });

  assert.equal(state.resume(), true);
  state.tick(1);
  assert.deepEqual(state.snapshot(), { progress: 137 / TUNNEL_CRUISE_MS, mode: "cruising" });
  state.tick(TUNNEL_CRUISE_MS - 1);
  assert.deepEqual(state.snapshot(), { progress: 137, mode: "ended" });
});

test("settles nominal decimal timing without finishing materially early", () => {
  const decimalCruise = createTunnelState({ maxProgress: 137 });
  for (let index = 0; index < 450000; index += 1) decimalCruise.tick(0.2);
  assert.deepEqual(decimalCruise.snapshot(), { progress: 137, mode: "ended" });

  const thirdsCruise = createTunnelState({ maxProgress: 137 });
  for (let index = 0; index < 270; index += 1) thirdsCruise.tick(1000 / 3);
  assert.deepEqual(thirdsCruise.snapshot(), { progress: 137, mode: "ended" });

  const justBeforeEnd = createTunnelState({ maxProgress: 137 });
  justBeforeEnd.tick(TUNNEL_CRUISE_MS - 0.001);
  assert.equal(justBeforeEnd.snapshot().mode, "cruising");

  const decimalRewind = createTunnelState({ maxProgress: 137 });
  decimalRewind.tick(TUNNEL_CRUISE_MS);
  decimalRewind.startRewind();
  for (let index = 0; index < 32000; index += 1) decimalRewind.tick(0.1);
  assert.deepEqual(decimalRewind.snapshot(), { progress: 0, mode: "paused" });
});

test("manual controls clamp progress and preserve rewind as an uninterruptible transition", () => {
  const state = createTunnelState({ maxProgress: 10 });
  assert.equal(state.nudge(-100), true);
  assert.deepEqual(state.snapshot(), { progress: 0, mode: "paused" });
  assert.equal(state.resume(), true);
  assert.equal(state.nudge(100), true);
  assert.deepEqual(state.snapshot(), { progress: 10, mode: "ended" });
  assert.equal(state.nudge(-3), true);
  assert.deepEqual(state.snapshot(), { progress: 7, mode: "paused" });
  assert.equal(state.resume(), true);
  assert.deepEqual(state.snapshot(), { progress: 7, mode: "cruising" });
  assert.equal(state.pause(), true);
  assert.equal(state.pause(), false);
  assert.equal(state.nudge(-100), true);
  assert.deepEqual(state.snapshot(), { progress: 0, mode: "paused" });
  assert.equal(state.resume(), true);
  state.nudge(10);
  assert.equal(state.resume(), false);
  assert.equal(state.startRewind(), true);
  assert.equal(state.startRewind(), false);
  assert.equal(state.nudge(-1), false);
  assert.equal(state.resume(), false);
  assert.equal(state.pause(), false);
  state.tick(1600);
  assert.deepEqual(state.snapshot(), { progress: 5, mode: "rewinding" });
});

test("validates inputs, restores initial state, and returns immutable snapshots", () => {
  for (const maxProgress of [-1, Number.MIN_VALUE, 1e-320, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "137"]) {
    assert.throws(() => createTunnelState({ maxProgress }), RangeError);
  }
  const zero = createTunnelState({ maxProgress: 0 });
  assert.deepEqual(zero.snapshot(), { progress: 0, mode: "ended" });
  const restored = createTunnelState({ maxProgress: 10, initialProgress: 100 });
  assert.deepEqual(restored.snapshot(), { progress: 10, mode: "ended" });
  const pausedEnd = createTunnelState({ maxProgress: 10, initialProgress: 10, initialMode: "paused" });
  assert.deepEqual(pausedEnd.snapshot(), { progress: 10, mode: "paused" });
  assert.throws(() => createTunnelState({ maxProgress: 10, initialMode: "invalid" }), RangeError);
  assert.throws(() => restored.tick(-1), RangeError);
  assert.throws(() => restored.tick(NaN), RangeError);
  assert.throws(() => restored.tick(Infinity), RangeError);
  assert.equal(restored.tick(0), false);
  assert.throws(() => restored.nudge(NaN), RangeError);
  const snapshot = restored.snapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => { snapshot.progress = 1; }, TypeError);
  assert.equal(restored.snapshot().progress, 10);
});

function createRendererFakes() {
  const resources = { renders: 0, textures: [], materials: [], geometry: null, renderer: null };
  class Object3D { constructor() { this.children = []; this.position = { set: (x, y, z) => { this.x = x; this.y = y; this.z = z; } }; this.rotation = { z: 0 }; } add(value) { this.children.push(value); } remove(value) { this.children = this.children.filter((item) => item !== value); } }
  class Scene extends Object3D { constructor() { super(); resources.scene = this; } }
  class PerspectiveCamera extends Object3D { constructor(fov, aspect, near, far) { super(); Object.assign(this, { fov, aspect, near, far }); } lookAt() {} updateProjectionMatrix() { this.updated = true; } }
  class PlaneGeometry { constructor(...args) { this.args = args; resources.geometry = this; } dispose() { this.disposed = (this.disposed ?? 0) + 1; } }
  class MeshBasicMaterial { constructor(options) { Object.assign(this, options); resources.materials.push(this); } dispose() { this.disposed = (this.disposed ?? 0) + 1; } }
  class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
  class WebGLRenderer { constructor() { const listeners = new Map(); this.domElement = { parentNode: null, style: {}, listeners, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); } }; resources.renderer = this; } setPixelRatio(value) { this.pixelRatio = value; } setSize(width, height) { this.size = [width, height]; } render(scene, camera) { resources.renders += 1; resources.camera = camera; resources.scene = scene; } dispose() { this.disposed = (this.disposed ?? 0) + 1; } }
  class TextureLoader { load(src, done, _progress, fail) { const texture = { src, dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; resources.textures.push(texture); done(texture); return texture; } }
  return { resources, three: { Scene, PerspectiveCamera, PlaneGeometry, MeshBasicMaterial, Mesh, WebGLRenderer, TextureLoader, FogExp2: class { constructor(color, density) { Object.assign(this, { color, density }); } }, DoubleSide: "double", SRGBColorSpace: "srgb" } };
}

function createRoot() {
  const listeners = new Map();
  const classes = new Set();
  return { clientWidth: 800, clientHeight: 500, children: [], classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) }, append(value) { value.parentNode = this; this.children.push(value); }, removeChild(value) { this.children = this.children.filter((item) => item !== value); value.parentNode = null; }, addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); }, getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }, setPointerCapture() {}, releasePointerCapture() {}, listeners };
}

test("mounts ordered cards, applies exact poses, camera progress, and releases every owned resource", () => {
  const { three, resources } = createRendererFakes();
  const root = createRoot();
  const frames = [];
  const tunnel = mountArchiveTunnel(root, archiveData, { three, requestFrame: (callback) => (frames.push(callback), frames.length), cancelFrame: () => {}, windowRef: { devicePixelRatio: 2, WebGLRenderingContext: function WebGLRenderingContext() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} } });
  assert.equal(root.children.length, 1);
  assert.equal(resources.renderer.size[0], 800);
  assert.equal(resources.renderer.pixelRatio, 1.6);
  assert.equal(resources.materials.length, 138);
  assert.deepEqual(resources.geometry.args, [1.82, 1.24]);
  assert.equal(resources.scene.children.length, 138);
  const firstPose = tunnelPose(0);
  const lastPose = tunnelPose(137);
  const first = resources.scene.children[0];
  const last = resources.scene.children.at(-1);
  assert.deepEqual([first.x, first.y, first.z, first.rotation.z], [firstPose.x, firstPose.y, firstPose.z, firstPose.rotationZ]);
  assert.deepEqual([last.x, last.y, last.z, last.rotation.z], [lastPose.x, lastPose.y, lastPose.z, lastPose.rotationZ]);
  assert.equal(tunnel.snapshot().progress, 0);
  frames.shift()(64);
  assert.equal(tunnel.snapshot().progress, 0);
  frames.shift()(128);
  assert.ok(tunnel.snapshot().progress > 0);
  assert.equal(resources.camera.z, 3 - tunnel.snapshot().progress * TUNNEL_STEP);
  tunnel.destroy();
  assert.equal(resources.geometry.disposed, 1);
  assert.equal(resources.renderer.disposed, 1);
  assert.ok(resources.materials.every((material) => material.disposed === 1));
});

test("keeps tunnel input listeners on its canvas rather than the mount root", () => {
  const { three } = createRendererFakes();
  const root = createRoot();
  const frames = [];
  const tunnel = mountArchiveTunnel(root, archiveData, { three, requestFrame: (callback) => (frames.push(callback), frames.length), cancelFrame() {}, windowRef: { devicePixelRatio: 1, WebGLRenderingContext: function WebGLRenderingContext() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} } });
  assert.equal(root.listeners.size, 0);
  assert.equal(root.children[0].listeners.size, 6);
  tunnel.destroy();
});

test("rolls back a partially initialized renderer and reports initialization failure once", () => {
  const { three, resources } = createRendererFakes();
  const root = createRoot();
  root.append = () => { throw new Error("append failed"); };
  const reasons = [];
  const tunnel = mountArchiveTunnel(root, archiveData, { three, onFallback: (reason) => reasons.push(reason), requestFrame: () => 1, cancelFrame() {}, windowRef: { devicePixelRatio: 1, WebGLRenderingContext: function WebGLRenderingContext() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} } });
  assert.deepEqual(reasons, ["initialization-failed"]);
  assert.equal(root.children.length, 0);
  assert.equal(root.listeners.size, 0);
  assert.equal(resources.renderer.disposed, 1);
  assert.equal(resources.geometry.disposed, 1);
  assert.ok(resources.materials.every((material) => material.disposed === 1));
  assert.equal(tunnel.destroy(), false);
});

test("registers each material before mesh construction so a partial card build rolls back", () => {
  const { three, resources } = createRendererFakes();
  let meshes = 0;
  three.Mesh = class ThrowingMesh extends three.Mesh { constructor(...args) { super(...args); if (++meshes === 4) throw new Error("fourth mesh"); } };
  const root = createRoot();
  const tunnel = mountArchiveTunnel(root, archiveData, { three, requestFrame: () => 1, cancelFrame() {}, windowRef: { WebGLRenderingContext: function WebGLRenderingContext() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} } });
  assert.equal(tunnel.destroy(), false);
  assert.equal(resources.materials.length, 4);
  assert.ok(resources.materials.every((material) => material.disposed === 1));
  assert.equal(resources.geometry.disposed, 1);
});

test("turns scheduler accessor and request failures into one clean fallback", () => {
  const { three, resources } = createRendererFakes();
  const root = createRoot();
  const reasons = [];
  const options = { three, cancelFrame() {}, windowRef: { WebGLRenderingContext: function WebGLRenderingContext() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} }, onFallback: (reason) => reasons.push(reason) };
  Object.defineProperty(options, "requestFrame", { get() { throw new Error("getter"); } });
  const tunnel = mountArchiveTunnel(root, archiveData, options);
  assert.equal(tunnel.destroy(), false);
  assert.deepEqual(reasons, ["initialization-failed"]);
  assert.equal(resources.renderer.disposed, 1);
  assert.equal(root.children.length, 0);
});

test("captured canvas handlers are inert after destroy", () => {
  const { three } = createRendererFakes();
  const root = createRoot(); const frames = [];
  const tunnel = mountArchiveTunnel(root, archiveData, { three, requestFrame: (fn) => (frames.push(fn), frames.length), cancelFrame() {}, windowRef: { WebGLRenderingContext: function WebGLRenderingContext() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} } });
  const wheel = root.children[0].listeners.get("wheel");
  tunnel.destroy();
  let prevented = 0;
  wheel({ deltaY: 10, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 0);
  assert.equal(tunnel.snapshot().progress, 0);
});

function createLifecycleHarness({ mobile = false, width = 800, height = 500, faults = {} } = {}) {
  const calls = { fallback: [], frames: [], cancelled: [], loads: [], end: [], select: [], removed: [], windowAdded: [], windowRemoved: [] };
  const resources = { materials: [], textures: [], meshes: [], renderCount: 0 };
  const canvasListeners = new Map();
  const classes = new Set(faults.preexistingClass ? ["archive-tunnel-surface"] : []);
  let appendCount = 0;
  const root = {
    clientWidth: width, clientHeight: height, children: [],
    classList: { contains: (n) => classes.has(n), add(n) { classes.add(n); }, remove(n) { calls.removed.push(`class:${n}`); classes.delete(n); if (faults.classRemove) throw Error("class remove"); } },
    append(node) { appendCount += 1; if (faults.appendBefore) throw Error("append"); node.parentNode = this; this.children.push(node); if (faults.appendAfter) throw Error("append after"); },
    removeChild(node) { calls.removed.push("canvas"); this.children = this.children.filter((v) => v !== node); node.parentNode = null; if (faults.canvasRemove) throw Error("remove"); },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
  };
  const canvas = {
    parentNode: null, style: {},
    addEventListener(name, fn, config) { if (faults.listenerAt === canvasListeners.size + 1) throw Error("listener"); canvasListeners.set(name, { fn, config }); },
    removeEventListener(name, fn) { calls.removed.push(`listener:${name}`); if (faults.listenerRemove) throw Error("listener remove"); if (canvasListeners.get(name)?.fn === fn) canvasListeners.delete(name); },
    getBoundingClientRect() { return root.getBoundingClientRect(); },
    setPointerCapture(id) { calls.capture = id; if (faults.capture) throw Error("capture"); },
    releasePointerCapture(id) { calls.release = id; if (faults.release) throw Error("release"); },
  };
  class Object3D { constructor() { this.children = []; this.position = { set: (x, y, z) => Object.assign(this.position, { x, y, z }) }; this.rotation = { z: 0 }; this.userData = {}; } add(v) { this.children.push(v); } remove(v) { calls.removed.push("mesh"); this.children = this.children.filter((x) => x !== v); } }
  class Scene extends Object3D { constructor() { super(); resources.scene = this; } }
  class PerspectiveCamera extends Object3D { constructor(fov, aspect, near, far) { super(); Object.assign(this, { fov, aspect, near, far }); resources.camera = this; } lookAt(...args) { this.look = args; } updateProjectionMatrix() { this.projections = (this.projections ?? 0) + 1; } }
  class PlaneGeometry { constructor(...args) { this.args = args; resources.geometry = this; } dispose() { this.disposed = (this.disposed ?? 0) + 1; if (faults.geometryDispose) throw Error("geometry dispose"); } }
  class MeshBasicMaterial { constructor(options) { if (faults.materialAt === resources.materials.length + 1) throw Error("material"); Object.assign(this, options); this.color = { value: options.color, set(value) { this.value = value; } }; resources.materials.push(this); } dispose() { this.disposed = (this.disposed ?? 0) + 1; if (faults.materialDispose) throw Error("material dispose"); } }
  class Mesh extends Object3D { constructor(geometry, material) { super(); if (faults.meshAt === resources.meshes.length + 1) throw Error("mesh"); this.geometry = geometry; this.material = material; resources.meshes.push(this); } }
  class WebGLRenderer { constructor(options) { if (faults.rendererCtor) throw Error("renderer"); this.options = options; this.domElement = canvas; resources.renderer = this; } setPixelRatio(v) { this.pixelRatio = v; if (faults.pixelRatio) throw Error("pixel"); } setSize(w, h, css) { this.size = [w, h, css]; if (faults.setSize) throw Error("size"); } render(scene, camera) { resources.renderCount += 1; if (faults.renderAt === resources.renderCount) throw Error("render"); this.lastRender = [scene, camera]; } dispose() { this.disposed = (this.disposed ?? 0) + 1; if (faults.rendererDispose) throw Error("renderer dispose"); } }
  class TextureLoader { load(src, success, _progress, failure) { const pending = { src, success, failure }; calls.loads.push(pending); return pending; } }
  class FogExp2 { constructor(color, density) { Object.assign(this, { color, density }); } }
  class Vector2 { constructor(x, y) { Object.assign(this, { x, y }); } }
  class Raycaster { setFromCamera(vector, camera) { this.vector = vector; this.camera = camera; } intersectObjects() { return faults.hit ? [{ object: resources.meshes[faults.hit - 1] }] : []; } }
  const three = { Scene, PerspectiveCamera, PlaneGeometry, MeshBasicMaterial, Mesh, WebGLRenderer, TextureLoader, FogExp2, Vector2, Raycaster, DoubleSide: "double", SRGBColorSpace: "srgb" };
  const windowListeners = new Map();
  const windowRef = {
    devicePixelRatio: faults.dpr ?? 2, WebGLRenderingContext: faults.noWebGL ? undefined : function WebGLRenderingContext() {},
    matchMedia: () => ({ matches: mobile }),
    addEventListener(name, fn) { calls.windowAdded.push(name); windowListeners.set(name, fn); if (faults.windowListener) throw Error("window listener"); },
    removeEventListener(name, fn) { calls.windowRemoved.push(name); if (faults.windowRemove) throw Error("window remove"); if (windowListeners.get(name) === fn) windowListeners.delete(name); },
  };
  let frameId = 100;
  const options = {
    three, windowRef,
    requestFrame(fn) { if (faults.requestFrame) throw Error("raf"); calls.frames.push(fn); frameId += 1; return frameId; },
    cancelFrame(id) { calls.cancelled.push(id); }, onFallback: (r) => calls.fallback.push(r), onEnd: (s) => calls.end.push(s), onSelect: (...a) => calls.select.push(a),
  };
  const mount = (data = archiveData, extra = {}) => mountArchiveTunnel(root, data, { ...options, ...extra });
  const fire = (name, event = {}) => canvasListeners.get(name)?.fn(event);
  const resolve = (index, texture = { id: index, dispose() { this.disposed = (this.disposed ?? 0) + 1; if (faults.textureDispose) throw Error("texture dispose"); } }) => (calls.loads[index].success(texture), texture);
  return { root, canvas, classes, calls, resources, three, windowRef, windowListeners, options, mount, fire, resolve, get appendCount() { return appendCount; } };
}

const expectedControllerKeys = ["destroy", "pause", "resume", "snapshot", "startRewind"];
function assertNoopController(controller) {
  assert.ok(Object.isFrozen(controller));
  assert.deepEqual(Object.keys(controller).sort(), expectedControllerKeys);
  assert.equal(controller.pause(), false); assert.equal(controller.resume(), false); assert.equal(controller.startRewind(), false); assert.equal(controller.destroy(), false);
  assert.deepEqual(controller.snapshot(), { progress: 0, mode: "paused" }); assert.ok(Object.isFrozen(controller.snapshot()));
}

test("renderer fallback paths are atomic, frozen, and report their exact reason once", () => {
  const cases = [
    ["missing-root", (h) => mountArchiveTunnel(null, archiveData, h.options)],
    ["invalid-data", (h) => h.mount(null)], ["invalid-data", (h) => h.mount({ cases: [] })],
    ["unusable-root", (h) => { h.root.clientWidth = 0; return h.mount(); }],
    ["webgl-unavailable", (h) => { h.windowRef.WebGLRenderingContext = undefined; return h.mount(); }],
    ["renderer-failed", (h) => h.mount(archiveData, { three: { ...h.three, WebGLRenderer: class { constructor() { throw Error("no"); } } } })],
  ];
  for (const [reason, invoke] of cases) { const h = createLifecycleHarness(); const api = invoke(h); assert.deepEqual(h.calls.fallback, [reason]); assertNoopController(api); assert.equal(h.root.children.length, 0); assert.equal(h.classes.size, 0); }
});

test("successful controller delegates, is frozen, and destroy is idempotent", () => {
  const h = createLifecycleHarness(); const api = h.mount();
  assert.ok(Object.isFrozen(api)); assert.deepEqual(Object.keys(api).sort(), expectedControllerKeys);
  assert.equal(api.pause(), true); assert.equal(api.pause(), false); assert.equal(api.resume(), true); assert.equal(api.startRewind(), false);
  assert.equal(api.destroy(), true); assert.equal(api.destroy(), false);
});

test("transactional initialization rolls back every acquired resource for construction and setup faults", () => {
  for (const faults of [{ materialAt: 4 }, { meshAt: 4 }, { appendBefore: true }, { appendAfter: true }, { listenerAt: 4 }, { windowListener: true }, { setSize: true }, { pixelRatio: true }, { requestFrame: true }, { renderAt: 1 }]) {
    const h = createLifecycleHarness({ faults }); const api = h.mount(); assertNoopController(api); assert.deepEqual(h.calls.fallback, ["initialization-failed"]); assert.equal(h.root.children.length, 0, JSON.stringify(faults));
    assert.equal(h.classes.has("archive-tunnel-surface"), false); assert.equal(h.resources.renderer.disposed, 1);
    if (h.resources.geometry) assert.equal(h.resources.geometry.disposed, 1);
    assert.ok(h.resources.materials.every((m) => m.disposed === 1));
  }
});

test("scene creates all 138 exact authored cards and camera/renderer contract", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const flat = flattenArchiveOccurrences(archiveData);
  assert.equal(h.resources.meshes.length, 138); assert.equal(h.resources.materials.length, 138); assert.equal(new Set(h.resources.meshes.map((m) => m.geometry)).size, 1); assert.deepEqual(h.resources.geometry.args, [1.82, 1.24]);
  h.resources.meshes.forEach((mesh, index) => { const pose = tunnelPose(index); assert.deepEqual([mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.z], [pose.x, pose.y, pose.z, pose.rotationZ]); assert.deepEqual(mesh.userData, { occurrence: flat[index] }); });
  assert.ok(h.resources.materials.every((m) => m.opacity === 1 && m.side === "double" && m.color.value === 0x1a1521));
  assert.deepEqual([h.resources.scene.fog.color, h.resources.scene.fog.density], [0x09070c, 0.032]);
  assert.deepEqual([h.resources.camera.fov, h.resources.camera.aspect, h.resources.camera.near, h.resources.camera.far], [46, 1.6, 0.1, 120]); assert.deepEqual(h.resources.camera.look, [0, 0, 2]);
  assert.deepEqual(h.resources.renderer.options, { alpha: true, antialias: true, powerPreference: "high-performance" }); assert.equal(h.resources.renderer.pixelRatio, 1.6); assert.deepEqual(h.resources.renderer.size.slice(0, 2), [800, 500]); api.destroy();
});

test("desktop and mobile texture windows load exact counts and lifecycle semantics", () => {
  for (const [mobile, initial, interior] of [[false, 33, 65], [true, 19, 37]]) {
    const h = createLifecycleHarness({ mobile }); const api = h.mount(); assert.equal(h.calls.loads.length, initial); assert.deepEqual(h.calls.loads.map((load) => load.src), flattenArchiveOccurrences(archiveData).slice(0, initial).map((item) => item.src));
    api.pause(); api.snapshot(); h.fire("wheel", { deltaY: 68 / .012, preventDefault() {} }); assert.equal(h.calls.loads.length, initial + interior); const start = 68 - (mobile ? 18 : 32); assert.deepEqual(h.calls.loads.slice(initial).map((load) => load.src), flattenArchiveOccurrences(archiveData).slice(start, start + interior).map((item) => item.src)); api.destroy();
  }
});

test("texture success, failure retry, stale callbacks, and unique disposal are safe", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const texture = h.resolve(0);
  assert.equal(texture.colorSpace, "srgb"); assert.equal(h.resources.materials[0].map, texture); assert.equal(h.resources.materials[0].color.value, 0xffffff); assert.equal(h.resources.materials[0].opacity, 1);
  const failedSrc = h.calls.loads[1].src; h.calls.loads[1].failure(); const count = h.calls.loads.length; h.calls.frames.shift()(0); assert.equal(h.calls.loads.length, count);
  h.fire("wheel", { deltaY: 10000, preventDefault() {} }); assert.equal(texture.disposed, 1);
  const stalePending = h.calls.loads[2]; const stale = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; stalePending.success(stale); assert.equal(stale.disposed, 1); assert.notEqual(h.resources.materials[2].map, stale); stalePending.failure();
  h.fire("wheel", { deltaY: -10000, preventDefault() {} }); assert.ok(h.calls.loads.length > count); assert.equal(h.calls.loads.filter((load) => load.src === failedSrc).length, 2); api.destroy();
  const late = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; h.calls.loads.at(-1).success(late); h.calls.loads.at(-1).failure(); assert.equal(late.disposed, 1);
});

test("RAF delta, end announcement, rewind reannouncement, and destroy from onEnd are exact", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const first = h.calls.frames.shift(); first(100); assert.equal(api.snapshot().progress, 0); const second = h.calls.frames.shift(); second(1000); assert.equal(api.snapshot().progress, 137 * 64 / 90000); assert.equal(h.resources.camera.position.z, 3 - api.snapshot().progress * TUNNEL_STEP); assert.equal(h.resources.renderCount, 3); assert.equal(h.calls.frames.length, 1); api.destroy(); assert.deepEqual(h.calls.cancelled, [103]);

  const custom = createLifecycleHarness(); let controller; const state = { mode: "cruising", snapshot() { return Object.freeze({ progress: this.mode === "ended" ? 137 : 0, mode: this.mode }); }, tick() { this.mode = "ended"; return true; }, pause() { return false; }, resume() { return false; }, nudge() { return false; }, startRewind() { this.mode = "rewinding"; return true; } };
  controller = custom.mount(archiveData, { stateFactory: () => state, onEnd(s) { custom.calls.end.push(s); controller.destroy(); } }); custom.calls.frames.shift()(1); assert.equal(custom.calls.end.length, 1); assert.ok(Object.isFrozen(custom.calls.end[0])); assert.equal(custom.resources.renderCount, 1); assert.equal(custom.calls.frames.length, 0);
});

test("end is announced once per arrival and a rewind permits a second announcement", () => {
  const h = createLifecycleHarness();
  const state = { progress: 0, mode: "cruising", snapshot() { return Object.freeze({ progress: this.progress, mode: this.mode }); }, tick() { if (this.mode === "cruising") { this.progress = 137; this.mode = "ended"; } else if (this.mode === "rewinding") { this.progress = 0; this.mode = "paused"; } return true; }, pause() { this.mode = "paused"; return true; }, resume() { this.mode = "cruising"; return true; }, nudge() { return false; }, startRewind() { if (this.mode !== "ended") return false; this.mode = "rewinding"; return true; } };
  const api = h.mount(archiveData, { stateFactory: () => state }); h.calls.frames.shift()(0); assert.equal(h.calls.end.length, 1); assert.equal(h.calls.frames.length, 0); assert.equal(api.startRewind(), true); h.calls.frames.shift()(32); assert.equal(api.resume(), true); h.calls.frames.shift()(48); assert.equal(h.calls.end.length, 2); api.destroy();
});

test("runtime render failure is contained and rolls down the mounted renderer", () => {
  const h = createLifecycleHarness({ faults: { renderAt: 2 } }); const api = h.mount(); const queued = h.calls.frames.shift(); assert.doesNotThrow(() => queued(16)); assert.equal(h.resources.renderer.disposed, 1); assert.equal(h.root.children.length, 0); assert.equal(h.calls.frames.length, 0); assert.equal(api.destroy(), false);
});

test("destroyed queued frame and late loads are inert and shared texture objects dispose once", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const queued = h.calls.frames[0]; const pending0 = h.calls.loads[0]; const pending1 = h.calls.loads[1]; const shared = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; pending0.success(shared); pending1.success(shared); const renders = h.resources.renderCount; api.destroy(); assert.equal(shared.disposed, 1); queued(999); assert.equal(h.resources.renderCount, renders); const late = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; pending0.success(late); pending0.success(late); assert.equal(late.disposed, 1);
});

test("duplicate successful loader callback cannot replace or leak the first assigned texture", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const pending = h.calls.loads[0]; const first = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; const duplicate = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; pending.success(first); pending.success(duplicate); assert.equal(h.resources.materials[0].map, first); assert.equal(duplicate.disposed, 1); api.destroy(); assert.equal(first.disposed, 1); assert.equal(duplicate.disposed, 1);
});

test("wheel, pointer drag/cancel, selection, and destroyed captured inputs obey state", () => {
  const h = createLifecycleHarness({ faults: { hit: 4 } }); const api = h.mount(); const initial = api.snapshot().progress; let prevented = 0;
  h.fire("wheel", { deltaY: 10, preventDefault() { prevented += 1; } }); assert.equal(prevented, 1); assert.ok(api.snapshot().progress > initial); h.fire("wheel", { deltaY: NaN, preventDefault() { prevented += 1; } }); assert.equal(prevented, 1);
  h.fire("pointerdown", { pointerId: 7, clientX: 10, clientY: 50 }); h.fire("pointermove", { pointerId: 7, clientX: 10, clientY: 20 }); assert.equal(h.calls.capture, 7); const afterUp = api.snapshot().progress; assert.ok(afterUp > initial); h.fire("pointerup", { pointerId: 7 }); assert.equal(h.calls.release, 7); h.fire("click", { clientX: 1, clientY: 1 }); assert.equal(h.calls.select.length, 0);
  h.fire("pointerdown", { pointerId: 8, clientX: 5, clientY: 5 }); h.fire("pointermove", { pointerId: 8, clientX: 7, clientY: 7 }); h.fire("pointercancel", { pointerId: 8 }); h.fire("pointerdown", { pointerId: 9, clientX: 5, clientY: 5 }); h.fire("pointerup", { pointerId: 9 }); h.fire("click", { clientX: 20, clientY: 20 }); assert.equal(h.calls.select.length, 1); assert.deepEqual(h.calls.select[0][0], flattenArchiveOccurrences(archiveData)[3]); assert.equal(h.calls.select[0][1], h.resources.meshes[3]); assert.equal(api.snapshot().mode, "paused");
  const wheel = h.canvas.listeners?.get?.("wheel")?.fn ?? h.fire.bind(null, "wheel"); api.destroy(); wheel({ deltaY: 10, preventDefault() { prevented += 1; } }); assert.equal(prevented, 1);
});

test("zero-size raycast is inert and rewind rejects input mutations", () => {
  const h = createLifecycleHarness({ faults: { hit: 1 } }); const api = h.mount(); h.root.clientWidth = 0; h.fire("click", { clientX: 0, clientY: 0 }); assert.equal(h.calls.select.length, 0); h.root.clientWidth = 800;
  h.fire("wheel", { deltaY: 99999, preventDefault() {} }); assert.equal(api.snapshot().mode, "ended"); assert.equal(api.startRewind(), true); const progress = api.snapshot().progress; h.fire("wheel", { deltaY: -100, preventDefault() {} }); h.fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 30 }); h.fire("pointermove", { pointerId: 1, clientX: 0, clientY: 0 }); assert.equal(api.snapshot().progress, progress); api.destroy();
});

test("wheel arrival onEnd may destroy without any post-callback scene work", () => {
  const h = createLifecycleHarness();
  let afterEndAccess = 0; let ended = false; let controller;
  const state = {
    progress: 136.9, mode: "paused",
    snapshot() { if (ended) afterEndAccess += 1; return Object.freeze({ progress: this.progress, mode: this.mode }); },
    tick() { return false; }, pause() { return false; }, resume() { return false; }, startRewind() { return false; },
    nudge(value) { this.progress = Math.min(137, this.progress + value); if (this.progress === 137) this.mode = "ended"; return true; },
  };
  controller = h.mount(archiveData, { stateFactory: () => state, onEnd(snapshot) { assert.deepEqual(snapshot, { progress: 137, mode: "ended" }); ended = true; controller.destroy(); } });
  const loads = h.calls.loads.length; const renders = h.resources.renderCount; const frames = h.calls.frames.length; const cameraZ = h.resources.camera.position.z;
  h.fire("wheel", { deltaY: 100, preventDefault() {} });
  assert.equal(afterEndAccess, 0); assert.equal(h.calls.loads.length, loads); assert.equal(h.resources.renderCount, renders); assert.equal(h.calls.frames.length, frames); assert.equal(h.resources.camera.position.z, cameraZ); assert.equal(h.root.children.length, 0); assert.equal(h.resources.renderer.disposed, 1); assert.equal(controller.destroy(), false);
});

test("pointercancel releases capture and makes the cancelled pointer immediately inert", () => {
  const h = createLifecycleHarness({ faults: { hit: 1 } }); const api = h.mount();
  h.fire("pointerdown", { pointerId: 8, clientX: 10, clientY: 40 }); assert.equal(h.calls.capture, 8);
  h.fire("pointercancel", { pointerId: 8, clientX: 10, clientY: 40 }); assert.equal(h.calls.release, 8);
  const progress = api.snapshot().progress; const captures = h.calls.capture; const selections = h.calls.select.length;
  h.fire("pointermove", { pointerId: 8, clientX: 10, clientY: 0 }); h.fire("pointerup", { pointerId: 8, clientX: 10, clientY: 0 });
  assert.equal(api.snapshot().progress, progress); assert.equal(h.calls.capture, captures); assert.equal(h.calls.select.length, selections);
  h.fire("pointerdown", { pointerId: 9, clientX: 20, clientY: 20 }); assert.equal(h.calls.capture, 9); h.fire("pointerup", { pointerId: 9, clientX: 20, clientY: 20 }); assert.equal(h.calls.release, 9); api.destroy();
});

test("live resize updates valid dimensions and captured resize is inert after destroy", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const resize = h.windowListeners.get("resize"); h.root.clientWidth = 600; h.root.clientHeight = 300; resize(); assert.equal(h.resources.camera.aspect, 2); assert.equal(h.resources.camera.projections, 2); assert.deepEqual(h.resources.renderer.size.slice(0, 2), [600, 300]);
  h.root.clientWidth = 0; const projections = h.resources.camera.projections; resize(); assert.equal(h.resources.camera.projections, projections); api.destroy(); resize(); assert.equal(h.resources.camera.projections, projections);
});

test("destroy exhaustively attempts cleanup despite throwing destructors and preserves pre-existing class", () => {
  const h = createLifecycleHarness({ faults: { textureDispose: true, materialDispose: true, geometryDispose: true, rendererDispose: true, listenerRemove: true, windowRemove: true, release: true, canvasRemove: true, classRemove: true } }); const api = h.mount(); h.resolve(0); h.fire("pointerdown", { pointerId: 3, clientX: 0, clientY: 0 }); assert.equal(api.destroy(), true); assert.equal(api.destroy(), false); assert.equal(h.calls.removed.filter((x) => x === "mesh").length, 138); assert.equal(h.resources.geometry.disposed, 1); assert.equal(h.resources.renderer.disposed, 1); assert.ok(h.resources.materials.every((m) => m.disposed === 1)); assert.ok(h.calls.cancelled.length === 1); assert.ok(h.calls.windowRemoved.includes("resize"));
  const pre = createLifecycleHarness({ faults: { preexistingClass: true } }); const preApi = pre.mount(); preApi.destroy(); assert.ok(pre.classes.has("archive-tunnel-surface"));
});

test("ordinary destroy removes the exact canvas and window listener set", () => {
  const h = createLifecycleHarness(); const api = h.mount(); api.destroy(); assert.deepEqual(h.calls.removed.filter((x) => x.startsWith("listener:")).sort(), ["listener:click", "listener:pointercancel", "listener:pointerdown", "listener:pointermove", "listener:pointerup", "listener:wheel"]); assert.deepEqual(h.calls.windowRemoved, ["resize"]); assert.equal(h.root.children.length, 0); assert.equal(h.classes.has("archive-tunnel-surface"), false);
});

test("renderer source keeps a soft fog surface and contains no striped or rotating decorative motifs", () => {
  const source = fs.readFileSync(new URL("../src/archive-tunnel.js", import.meta.url), "utf8"); assert.match(source, /FogExp2/); assert.match(source, /archive-tunnel-surface/); assert.doesNotMatch(source, /repeating-conic-gradient|rotating\s+beam|spin\s*background|LineGeometry|RayGeometry/i);
});

test("deferred texture loads stay bounded to one in-flight request per card under 1000 window flips", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const firstSrc = h.calls.loads[0].src;
  for (let index = 0; index < 1000; index += 1) {
    h.fire("wheel", { deltaY: 99999, preventDefault() {} });
    h.fire("wheel", { deltaY: -99999, preventDefault() {} });
  }
  assert.equal(h.calls.loads.length, 66); assert.equal(h.calls.loads.filter((load) => load.src === firstSrc).length, 1);
  const stale = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; h.calls.loads[0].success(stale);
  assert.equal(stale.disposed, 1); assert.equal(h.calls.loads.filter((load) => load.src === firstSrc).length, 2); assert.equal(h.calls.loads.length, 67); api.destroy();
});

test("paused and ended tunnels do not maintain an idle RAF loop, while resume and rewind schedule once", () => {
  const h = createLifecycleHarness(); const pausedState = createTunnelState({ maxProgress: 137, initialMode: "paused" }); const api = h.mount(archiveData, { stateFactory: () => pausedState });
  assert.equal(h.calls.frames.length, 0); const initialRenders = h.resources.renderCount;
  h.fire("wheel", { deltaY: 10, preventDefault() {} }); assert.equal(h.resources.renderCount, initialRenders + 1); assert.equal(h.calls.frames.length, 0);
  assert.equal(api.resume(), true); assert.equal(h.calls.frames.length, 1); assert.equal(api.resume(), false); assert.equal(h.calls.frames.length, 1);
  assert.equal(api.pause(), true); assert.deepEqual(h.calls.cancelled, [101]); assert.equal(api.pause(), false);
  api.destroy();

  const ended = createLifecycleHarness(); const endedState = createTunnelState({ maxProgress: 137, initialProgress: 137 }); const endedApi = ended.mount(archiveData, { stateFactory: () => endedState }); assert.equal(ended.calls.frames.length, 0); assert.equal(endedApi.startRewind(), true); assert.equal(ended.calls.frames.length, 1); assert.equal(endedApi.startRewind(), false); assert.equal(ended.calls.frames.length, 1); endedApi.destroy();
});

test("a frame that arrives at ended renders once and schedules no further RAF", () => {
  const h = createLifecycleHarness(); const state = { mode: "cruising", snapshot() { return Object.freeze({ progress: this.mode === "ended" ? 137 : 136, mode: this.mode }); }, tick() { this.mode = "ended"; return true; }, pause() { return false; }, resume() { return false; }, nudge() { return false; }, startRewind() { return false; } };
  const api = h.mount(archiveData, { stateFactory: () => state }); assert.equal(h.calls.frames.length, 1); const queued = h.calls.frames.shift(); const renders = h.resources.renderCount; queued(10); assert.equal(h.resources.renderCount, renders + 1); assert.equal(h.calls.frames.length, 0); api.destroy();
});

test("texture completion while paused paints one static frame without starting RAF", () => {
  const h = createLifecycleHarness(); const paused = createTunnelState({ maxProgress: 137, initialMode: "paused" }); const api = h.mount(archiveData, { stateFactory: () => paused }); const renders = h.resources.renderCount; assert.equal(h.calls.frames.length, 0); h.resolve(0); assert.equal(h.resources.renderCount, renders + 1); assert.equal(h.calls.frames.length, 0); api.destroy();
});

test("throwing consumer callbacks are isolated from RAF, wheel, and selection", () => {
  for (const viaWheel of [false, true]) {
    const h = createLifecycleHarness({ faults: { hit: 1 } }); const state = { progress: viaWheel ? 136.9 : 136, mode: viaWheel ? "paused" : "cruising", snapshot() { return Object.freeze({ progress: this.progress, mode: this.mode }); }, tick() { this.progress = 137; this.mode = "ended"; return true; }, nudge() { this.progress = 137; this.mode = "ended"; return true; }, pause() { this.mode = "paused"; return true; }, resume() { return false; }, startRewind() { return false; } };
    const api = h.mount(archiveData, { stateFactory: () => state, onEnd() { throw Error("consumer end"); }, onSelect() { throw Error("consumer select"); } });
    if (viaWheel) assert.doesNotThrow(() => h.fire("wheel", { deltaY: 100, preventDefault() {} })); else assert.doesNotThrow(() => h.calls.frames.shift()(10));
    assert.equal(api.snapshot().mode, "ended"); assert.equal(h.root.children.length, 1); assert.equal(h.resources.renderer.disposed, undefined);
    assert.doesNotThrow(() => h.fire("click", { clientX: 10, clientY: 10 })); assert.equal(api.snapshot().mode, "paused"); assert.equal(h.root.children.length, 1); api.destroy();
  }
});

test("unload and destroy clear material texture references and renderer uses weak disposal tracking", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const texture = h.resolve(0); assert.equal(h.resources.materials[0].map, texture); h.fire("wheel", { deltaY: 99999, preventDefault() {} }); assert.equal(h.resources.materials[0].map, null); assert.equal(texture.disposed, 1);
  const tailIndex = h.calls.loads.length - 1; const tailTexture = h.resolve(tailIndex); const mapped = h.resources.materials.find((material) => material.map === tailTexture); assert.ok(mapped); api.destroy(); assert.equal(mapped.map, null); assert.equal(tailTexture.disposed, 1);
  const source = fs.readFileSync(new URL("../src/archive-tunnel.js", import.meta.url), "utf8"); assert.match(source, /disposed:\s*new WeakSet\(\)/); assert.doesNotMatch(source, /disposed:\s*new Set\(\)/);
});

test("restarted cruise and rewind loops ignore idle wall time on their first frame", () => {
  const h = createLifecycleHarness(); const api = h.mount(); h.calls.frames.shift()(100); assert.equal(api.snapshot().progress, 0); assert.equal(api.pause(), true); assert.equal(api.resume(), true); h.calls.frames.at(-1)(10000); assert.equal(api.snapshot().progress, 0); h.calls.frames.at(-1)(10016); assert.equal(api.snapshot().progress, 137 * 16 / 90000); api.destroy();

  const rewind = createLifecycleHarness(); const rewindApi = rewind.mount(); rewind.calls.frames.shift()(100); rewind.fire("wheel", { deltaY: 99999, preventDefault() {} }); assert.equal(rewindApi.snapshot().mode, "ended"); assert.equal(rewindApi.startRewind(), true); rewind.calls.frames.at(-1)(10000); assert.deepEqual(rewindApi.snapshot(), { progress: 137, mode: "rewinding" }); rewindApi.destroy();
});

test("idle resize repaints one static frame without creating a continuous RAF", () => {
  const h = createLifecycleHarness(); const paused = createTunnelState({ maxProgress: 137, initialMode: "paused" }); const api = h.mount(archiveData, { stateFactory: () => paused }); assert.equal(h.calls.frames.length, 0); const renders = h.resources.renderCount; h.root.clientWidth = 640; h.root.clientHeight = 320; h.windowListeners.get("resize")(); assert.equal(h.resources.renderCount, renders + 1); assert.equal(h.calls.frames.length, 0); assert.equal(h.resources.camera.aspect, 2); api.destroy();
});

test("duplicate success after a loaded texture neither replaces it nor starts a fresh request", () => {
  const h = createLifecycleHarness(); const api = h.mount(); const pending = h.calls.loads[0]; const original = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; const duplicate = { dispose() { this.disposed = (this.disposed ?? 0) + 1; } }; pending.success(original); assert.equal(h.calls.loads.length, 33); pending.success(duplicate); assert.equal(h.calls.loads.length, 33); assert.equal(h.resources.materials[0].map, original); assert.equal(duplicate.disposed, 1); api.destroy(); assert.equal(original.disposed, 1);
});
