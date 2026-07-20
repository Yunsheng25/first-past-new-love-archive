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
