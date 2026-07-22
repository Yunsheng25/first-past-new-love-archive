import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import archiveData from "../data/archive.json" with { type: "json" };
import {
  APPROVED_TUNNEL_CAMERA_END,
  APPROVED_TUNNEL_CAMERA_START,
  APPROVED_TUNNEL_DEPTH_STEP,
  TUNNEL_MAX_INDEX,
  approvedTunnelPose,
  approvedTunnelPoseInto,
  approvedTunnelVisibleRange,
  flattenArchiveOccurrences,
  groupCaseImages,
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
    status: "error",
    errorGroup: archiveData.cases[0].errorGroup,
    errorReason: archiveData.cases[0].errorReason,
  });
  assert.deepEqual(items.at(-1), {
    order: 138,
    caseId: "case-72",
    caseIndex: 71,
    imageIndex: 0,
    title: archiveData.cases.at(-1).title,
    role: archiveData.cases.at(-1).images[0].role,
    src: archiveData.cases.at(-1).images[0].src,
    status: "normal",
    errorGroup: null,
    errorReason: null,
  });
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(flatSignature(items))).digest("hex"),
    "196ef58e605fa5de25c68cbf6e4bf285d924dde18d8d515f93f1032948e14bd8",
  );
});

test("carries authored error semantics into every tunnel occurrence without changing order", () => {
  const items = flattenArchiveOccurrences(archiveData);
  const firstError = items.find((item) => item.caseId === "case-01");
  const firstNormal = items.find((item) => item.caseId === "case-04");

  assert.equal(firstError.status, "error");
  assert.equal(firstError.errorGroup, "出现人脸");
  assert.equal(firstNormal.status, "normal");
  assert.equal(firstNormal.errorGroup, null);
  assert.deepEqual(items.map((item) => item.order), Array.from({ length: 138 }, (_, index) => index + 1));
  assert.ok(Object.isFrozen(firstError));
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

test("matches the approved v15 projection signatures at the entrance, middle, and end", () => {
  const viewport = { width: 1440, height: 900 };
  const signatures = [
    approvedTunnelPose(0, { ...viewport, position: APPROVED_TUNNEL_CAMERA_START }),
    approvedTunnelPose(8, { ...viewport, position: APPROVED_TUNNEL_CAMERA_START }),
    approvedTunnelPose(68, { ...viewport, position: 3562 }),
    approvedTunnelPose(137, { ...viewport, position: APPROVED_TUNNEL_CAMERA_END }),
  ].map(({ x, y, scale, opacity, visible, zIndex, rotationZ }) => ({
    x: Number(x.toFixed(6)),
    y: Number(y.toFixed(6)),
    scale: Number(scale.toFixed(6)),
    opacity: Number(opacity.toFixed(6)),
    visible,
    zIndex,
    rotationZ: Number(rotationZ.toFixed(6)),
  }));

  assert.deepEqual(signatures, [
    { x: 348.095238, y: 0, scale: 0.809524, opacity: 1, visible: true, zIndex: 9840, rotationZ: 84 },
    { x: 227.191413, y: 33.672692, scale: 0.541401, opacity: 0.787261, visible: true, zIndex: 9424, rotationZ: 456.605071 },
    { x: 84.088177, y: -291.042059, scale: 1.039755, opacity: 1, visible: true, zIndex: 10026, rotationZ: 3244.840572 },
    { x: -79.938296, y: -280.031908, scale: 1, opacity: 1, visible: true, zIndex: 10000, rotationZ: 6467.286215 },
  ]);
});

test("the approved v15 model recedes toward the center with dense separated rings and planar card rotation", () => {
  const camera = { width: 1440, height: 900, position: APPROVED_TUNNEL_CAMERA_START };
  const near = approvedTunnelPose(0, camera);
  const middle = approvedTunnelPose(8, camera);
  const deep = approvedTunnelPose(16, camera);
  const radii = [near, middle, deep].map((pose) => Math.hypot(pose.x, pose.y));

  assert.ok(near.scale > middle.scale && middle.scale > deep.scale);
  assert.ok(radii[0] > radii[1] && radii[1] > radii[2]);
  assert.ok(radii[0] - radii[1] > 100 && radii[0] - radii[1] < 150);
  assert.ok(radii[1] - radii[2] > 45 && radii[1] - radii[2] < 90);
  for (const pose of [near, middle, deep]) {
    assert.deepEqual(Object.keys(pose), ["x", "y", "scale", "opacity", "visible", "zIndex", "rotationZ"]);
    assert.ok(Object.isFrozen(pose));
    assert.equal("rotationX" in pose, false);
    assert.equal("rotationY" in pose, false);
    assert.ok(Number.isFinite(pose.rotationZ));
  }
});

test("the approved v15 visibility window preserves its long depth and rejects invalid camera input", () => {
  const camera = { width: 1440, height: 900, position: APPROVED_TUNNEL_CAMERA_START };
  assert.equal(APPROVED_TUNNEL_DEPTH_STEP, 52);
  assert.equal(approvedTunnelPose(91, camera).visible, true);
  assert.equal(approvedTunnelPose(92, camera).visible, false);
  assert.ok(approvedTunnelPose(91, camera).opacity >= 0.1);

  for (const invalidIndex of [-1, 1.5, 138, NaN, Infinity, "1"]) {
    assert.throws(() => approvedTunnelPose(invalidIndex, camera), RangeError);
  }
  for (const invalidCamera of [null, {}, { width: 0, height: 900, position: 0 }, { width: 1440, height: NaN, position: 0 }, { width: 1440, height: 900, position: Infinity }]) {
    assert.throws(() => approvedTunnelPose(0, invalidCamera), RangeError);
  }
});

test("production renderer is a front-facing DOM card layer driven only by approvedTunnelPose", () => {
  const source = fs.readFileSync(new URL("../src/archive-tunnel.js", import.meta.url), "utf8");

  assert.match(source, /approvedTunnelPose/);
  assert.match(source, /archive-tunnel-card/);
  assert.match(source, /translate\(-50%,\s*-50%\)\s+translate\(/);
  assert.match(source, /card\.style\.opacity/);
  assert.match(source, /rotate\(\$\{pose\.rotationZ\}deg\)/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/vendor\/three|WebGLRenderer|PerspectiveCamera|Raycaster|\btunnelPose\b|rotationX|rotationY|\.position\.set/);
});

test("archive tunnel CSS reproduces the approved soft-light stage without ray motifs", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.archive-tunnel-stage\s*\{[^}]*radial-gradient\(ellipse at 50% 52%,\s*#000 0 7%/s);
  assert.match(css, /\.archive-tunnel-stage::before/);
  assert.match(css, /\.archive-tunnel-card\s*\{[^}]*left:\s*50%[^}]*top:\s*52%/s);
  assert.match(css, /\.archive-tunnel-card img\s*\{[^}]*opacity:\s*1[^}]*filter:\s*none/s);
  assert.match(css, /\.archive-rewind\s*\{[^}]*width:\s*110px[^}]*height:\s*110px[^}]*border-radius:\s*50%/s);
  assert.doesNotMatch(css, /repeating-conic-gradient|archive-rays|tunnel-rays/i);
});

test("the passive ARCHIVE mouth never intercepts the stage while only rewind-ready is interactive", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.archive-rewind\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.archive-rewind\.is-archive\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.archive-rewind:disabled:not\(\.is-archive\)\s*\{[^}]*pointer-events:\s*none/s);
});

test("hidden tunnel controls cannot intercept pointer input", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.archive-rewind\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
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

function createDomHarness({ initialMode = "cruising", initialProgress, faults = {}, callbacks = {} } = {}) {
  const metrics = { styleWrites: 0, hiddenWrites: 0, hiddenTrue: 0, hiddenFalse: 0 };
  const imageDecodes = [];
  class FakeNode {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = [];
      this.style = new Proxy({}, { set(target, key, value) { metrics.styleWrites += 1; target[key] = value; return true; } });
      this.dataset = {}; this.listeners = new Map(); this.className = ""; this.parentNode = null; this._hidden = false;
      if (tag.toLowerCase() === "img") {
        this.complete = !faults.pendingImages;
        this.naturalWidth = faults.pendingImages ? 0 : 100;
        if (faults.pendingImages) {
          this.decode = () => new Promise((resolve, reject) => imageDecodes.push({ node: this, resolve, reject }));
        }
      }
    }
    get hidden() { return this._hidden; }
    set hidden(value) { metrics.hiddenWrites += 1; metrics[value ? "hiddenTrue" : "hiddenFalse"] += 1; this._hidden = value; }
    append(...nodes) { nodes.forEach((node) => { node.parentNode = this; this.children.push(node); }); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this); this.parentNode = null; }
    setAttribute(name, value) { this[name] = String(value); }
    addEventListener(name, listener, config) { this.listeners.set(name, { listener, config }); }
    removeEventListener(name, listener) { if (this.listeners.get(name)?.listener === listener) this.listeners.delete(name); }
    fire(name, event = {}) { this.listeners.get(name)?.listener({ target: this, ...event }); }
    closest(selector) { return selector === ".archive-tunnel-card" && this.className.split(/\s+/).includes("archive-tunnel-card") ? this : null; }
  }
  let created = 0;
  const documentRef = { createElement(tag) { created += 1; if (created === faults.createAt) throw Error("create failure"); return new FakeNode(tag); } };
  const classes = new Set();
  const root = new FakeNode("div");
  root.clientWidth = 1440; root.clientHeight = 900; root.ownerDocument = documentRef;
  root.classList = { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) };
  root.setPointerCapture = (id) => { root.captured = id; };
  root.releasePointerCapture = (id) => { root.released = id; };
  if (faults.append) root.append = function appendThenThrow(node) { FakeNode.prototype.append.call(this, node); throw Error("append failure"); };
  const frames = [];
  const cancelled = [];
  const windowListeners = new Map();
  const windowRef = {
    requestAnimationFrame(callback) { if (faults.requestFrame) throw Error("RAF failure"); frames.push(callback); return frames.length; },
    cancelAnimationFrame(id) { cancelled.push(id); },
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener(name, listener) { if (windowListeners.get(name) === listener) windowListeners.delete(name); },
  };
  if (faults.requestGetter) Object.defineProperty(windowRef, "requestAnimationFrame", { get() { throw Error("RAF getter failure"); } });
  const progress = []; const selected = []; const ended = []; const fallback = [];
  const controller = mountArchiveTunnel(root, archiveData, {
    windowRef, documentRef, initialProgress,
    stateFactory: callbacks.stateFactory ?? (({ maxProgress }) => createTunnelState({ maxProgress, initialMode })),
    onProgress: callbacks.onProgress ?? ((snapshot) => progress.push(snapshot)),
    onSelect: callbacks.onSelect ?? ((...args) => selected.push(args)),
    onEnd: callbacks.onEnd ?? ((snapshot) => ended.push(snapshot)),
    onFallback: (reason) => fallback.push(reason),
  });
  return { root, classes, frames, cancelled, windowListeners, progress, selected, ended, fallback, metrics, imageDecodes, controller };
}

test("DOM construction and append failures fall back atomically without leaked listeners, classes or children", () => {
  for (const faults of [{ createAt: 7 }, { append: true }, { requestFrame: true }, { requestGetter: true }]) {
    const h = createDomHarness({ faults });
    assert.deepEqual(h.fallback, ["initialization-failed"]);
    assert.equal(h.root.children.length, 0);
    assert.equal(h.root.listeners.size, 0);
    assert.equal(h.windowListeners.size, 0);
    assert.equal(h.controller.destroy(), false);
  }
});

test("allocation-free projection and visible ranges stay exactly equivalent to the approved v15 oracle", () => {
  const target = {};
  let maximumCandidates = 0;
  for (const position of [APPROVED_TUNNEL_CAMERA_START, 0, 3562, APPROVED_TUNNEL_CAMERA_END]) {
    const camera = { width: 1440, height: 900, position };
    const range = approvedTunnelVisibleRange(camera.position, 138);
    maximumCandidates = Math.max(maximumCandidates, range.end - range.start + 1);
    for (let index = range.start; index <= range.end; index += 1) {
      assert.equal(approvedTunnelPoseInto(index, camera, target), target);
      assert.deepEqual({ ...target }, { ...approvedTunnelPose(index, camera) });
    }
  }
  for (let position = APPROVED_TUNNEL_CAMERA_START; position <= APPROVED_TUNNEL_CAMERA_END; position += 13) {
    const range = approvedTunnelVisibleRange(position, 138);
    maximumCandidates = Math.max(maximumCandidates, range.end - range.start + 1);
  }
  assert.equal(maximumCandidates, 104);
  assert.deepEqual(approvedTunnelVisibleRange(APPROVED_TUNNEL_CAMERA_START, 138), { start: 0, end: 91 });
  assert.throws(() => approvedTunnelPoseInto(0, { width: 0, height: 1, position: 0 }, target), RangeError);
});

test("DOM renderer mounts all ordered front-facing cards with exact entrance poses and full-opacity images", () => {
  const h = createDomHarness({ initialMode: "paused" });
  assert.equal(h.root.children.length, 1);
  const layer = h.root.children[0];
  assert.equal(layer.className, "archive-tunnel-card-layer");
  assert.equal(layer.children.length, 138);
  const first = layer.children[0];
  const pose = approvedTunnelPose(0, { width: 1440, height: 900, position: APPROVED_TUNNEL_CAMERA_START });
  assert.equal(first.dataset.order, "1");
  assert.equal(first.dataset.status, "error");
  assert.equal(first.style.transform, `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px) scale(${pose.scale}) rotate(${pose.rotationZ}deg)`);
  assert.equal(first.children[0].src, archiveData.cases[0].images[0].src);
  assert.equal(first.children[0].style.opacity, undefined);
  assert.equal(first.dataset.paintReady, "ready");
  assert.equal(first.dataset.inRange, "true");
  assert.equal(layer.children.at(-1).dataset.inRange, "false");
  assert.equal(first.children[1].textContent, "错误尝试");
  assert.equal(layer.children.at(-1).dataset.order, "138");
  assert.match(layer.children[0].className, /archive-tunnel-card--portrait/);
  assert.match(layer.children[3].className, /archive-tunnel-card--tall/);
  assert.match(layer.children[5].className, /archive-tunnel-card--portrait/);
  assert.match(layer.children[15].className, /archive-tunnel-card--portrait/);
  h.controller.destroy();
});

test("wheel and drag advance the long approved journey while exact card clicks pause and select", () => {
  const h = createDomHarness({ initialMode: "paused" });
  let prevented = 0;
  h.root.fire("wheel", { deltaY: 100, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.ok(h.controller.snapshot().progress > 0);
  h.root.fire("pointerdown", { pointerId: 3, clientX: 10, clientY: 100, target: h.root });
  h.root.fire("pointermove", { pointerId: 3, clientX: 10, clientY: 60, target: h.root });
  h.root.fire("pointerup", { pointerId: 3, clientX: 10, clientY: 60, target: h.root });
  assert.equal(h.root.captured, 3); assert.equal(h.root.released, 3);
  // The synthetic click produced by the drag is suppressed once.
  h.root.fire("click", { target: h.root });
  const card = h.root.children[0].children[8];
  h.root.fire("pointerdown", { pointerId: 4, clientX: 20, clientY: 20, target: card });
  card.fire("click");
  assert.equal(h.selected.length, 1);
  assert.equal(h.selected[0][0].order, 9);
  assert.equal(h.selected[0][1], card);
  assert.equal(h.controller.snapshot().mode, "paused");
  h.controller.destroy();
});

test("cruise, end and 3.2-second rewind retain deterministic controller behavior", () => {
  const h = createDomHarness();
  assert.equal(h.frames.length, 1);
  h.frames.shift()(0);
  let now = 0;
  while (h.controller.snapshot().mode === "cruising") { now += 64; h.frames.shift()(now); }
  assert.deepEqual(h.controller.snapshot(), { progress: 137, mode: "ended" });
  assert.equal(h.ended.length, 1);
  assert.equal(h.controller.startRewind(), true);
  h.frames.shift()(100000);
  let rewindNow = 100000;
  while (h.controller.snapshot().mode === "rewinding") { rewindNow += 64; h.frames.shift()(rewindNow); }
  assert.deepEqual(h.controller.snapshot(), { progress: 0, mode: "paused" });
  assert.equal(h.controller.resume(), true);
  assert.equal(h.frames.length, 1);
  h.controller.destroy();
});

test("destroy removes listeners, image references, RAF and owned DOM idempotently", () => {
  const h = createDomHarness();
  const layer = h.root.children[0]; const images = layer.children.map((card) => card.children[0]);
  assert.equal(h.controller.destroy(), true);
  assert.equal(h.controller.destroy(), false);
  assert.equal(h.root.children.length, 0);
  assert.ok(images.every((image) => image.src === ""));
  assert.equal(h.root.listeners.size, 0);
  assert.equal(h.windowListeners.size, 0);
  assert.ok(h.cancelled.length >= 1);
});

test("pending images stay hidden until decoded and loaded cache re-entry paints immediately", async () => {
  const h = createDomHarness({ initialMode: "paused", faults: { pendingImages: true } });
  const first = h.root.children[0].children[0];
  assert.equal(first.hidden, true);
  assert.equal(first.dataset.paintReady, "pending");
  await Promise.resolve();
  const pending = h.imageDecodes.find((item) => item.node === first.children[0]);
  pending.node.complete = true;
  pending.node.naturalWidth = 100;
  pending.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.hidden, false);
  assert.equal(first.dataset.paintReady, "ready");

  h.root.fire("wheel", { deltaY: 99999, preventDefault() {} });
  assert.equal(first.hidden, true);
  h.root.fire("wheel", { deltaY: -99999, preventDefault() {} });
  assert.equal(first.hidden, false);
  assert.equal(first.dataset.paintReady, "ready");
  h.controller.destroy();
});

test("stale decode completion cannot reveal a card after range exit or destroy", async () => {
  const exited = createDomHarness({ initialMode: "paused", faults: { pendingImages: true } });
  const first = exited.root.children[0].children[0];
  await Promise.resolve();
  const pending = exited.imageDecodes.find((item) => item.node === first.children[0]);
  exited.root.fire("wheel", { deltaY: 99999, preventDefault() {} });
  pending.node.complete = true; pending.node.naturalWidth = 100; pending.resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(first.hidden, true);
  exited.controller.destroy();

  const destroyed = createDomHarness({ initialMode: "paused", faults: { pendingImages: true } });
  const destroyedFirst = destroyed.root.children[0].children[0];
  await Promise.resolve();
  const destroyedPending = destroyed.imageDecodes.find((item) => item.node === destroyedFirst.children[0]);
  destroyed.controller.destroy();
  destroyedPending.node.complete = true; destroyedPending.node.naturalWidth = 100; destroyedPending.resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(destroyedFirst.hidden, true);
});

test("decode rejection waits for load and image failure uses a visible non-white fallback", async () => {
  const h = createDomHarness({ initialMode: "paused", faults: { pendingImages: true } });
  const first = h.root.children[0].children[0];
  await Promise.resolve();
  const firstPending = h.imageDecodes.find((item) => item.node === first.children[0]);
  firstPending.reject(Error("decode unavailable"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(first.hidden, true);
  first.children[0].complete = true; first.children[0].naturalWidth = 100;
  first.children[0].fire("load");
  assert.equal(first.hidden, false);
  assert.equal(first.dataset.paintReady, "ready");

  const second = h.root.children[0].children[1];
  second.children[0].fire("error");
  assert.equal(second.hidden, false);
  assert.equal(second.dataset.paintReady, "failed");
  assert.match(second.className, /is-load-failed/);
  h.controller.destroy();
});

test("DOM fallback controllers are frozen, atomic and report exact reasons once", () => {
  const reasons = [];
  const fallback = mountArchiveTunnel(null, archiveData, { onFallback: (reason) => reasons.push(reason) });
  assert.ok(Object.isFrozen(fallback));
  assert.deepEqual(fallback.snapshot(), { progress: 0, mode: "paused" });
  assert.equal(fallback.pause(), false); assert.equal(fallback.resume(), false); assert.equal(fallback.startRewind(), false); assert.equal(fallback.destroy(), false);
  assert.deepEqual(reasons, ["missing-root"]);
  const h = createDomHarness({ initialMode: "paused" });
  h.controller.destroy();
});

test("renderer eagerly activates only the approved visible image window and preserves loaded cache on range exit", () => {
  const h = createDomHarness({ initialMode: "paused" });
  const cards = h.root.children[0].children;
  for (let index = 0; index <= 91; index += 1) {
    const image = cards[index].children[0];
    assert.equal(image.src, archiveData.cases.flatMap(item => item.images)[index].src);
    assert.equal(image.loading, "eager");
    assert.equal(image.decoding, "async");
    assert.equal(image.fetchPriority, "high");
  }
  for (let index = 92; index < cards.length; index += 1) {
    const image = cards[index].children[0];
    assert.equal(image.src ?? "", "");
    assert.equal(image.loading, "lazy");
    assert.equal(image.fetchPriority, "low");
  }

  h.root.fire("wheel", { deltaY: 99999, preventDefault() {} });
  assert.equal(cards[0].children[0].src, archiveData.cases[0].images[0].src, "leaving the range retains the decoded/cacheable source");
  for (let index = 128; index < cards.length; index += 1) {
    const image = cards[index].children[0];
    assert.ok(image.src);
    assert.equal(image.loading, "eager");
    assert.equal(image.fetchPriority, "high");
  }
  h.controller.destroy();
});

test("restored progress renders its approved camera position and resumes cruise from that exact occurrence", () => {
  const h = createDomHarness({ initialProgress: 41 });
  assert.equal(h.controller.snapshot().progress, 41);
  assert.equal(h.controller.snapshot().mode, "cruising");
  assert.deepEqual(h.progress[0], { progress: 41, mode: "cruising" });
  const cameraPosition = APPROVED_TUNNEL_CAMERA_START + (APPROVED_TUNNEL_CAMERA_END - APPROVED_TUNNEL_CAMERA_START) * (41 / 137);
  const pose = approvedTunnelPose(41, { width: 1440, height: 900, position: cameraPosition });
  assert.equal(h.root.children[0].children[41].style.transform, `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px) scale(${pose.scale}) rotate(${pose.rotationZ}deg)`);
  h.controller.destroy();
});

test("rewind rejects wheel, drag and card selection until the deterministic rewind completes", () => {
  const h = createDomHarness({ initialMode: "paused" });
  h.root.fire("wheel", { deltaY: 99999, preventDefault() {} });
  assert.equal(h.controller.snapshot().mode, "ended");
  assert.equal(h.controller.startRewind(), true);
  const progress = h.controller.snapshot().progress;
  h.root.fire("wheel", { deltaY: -99999, preventDefault() {} });
  h.root.fire("pointerdown", { pointerId: 2, clientX: 0, clientY: 100, target: h.root });
  h.root.fire("pointermove", { pointerId: 2, clientX: 0, clientY: 0, target: h.root });
  h.root.children[0].children[0].fire("click");
  assert.equal(h.controller.snapshot().progress, progress);
  assert.equal(h.selected.length, 0);
  h.controller.destroy();
});

test("pointer cancel releases capture and captured input handlers become inert after destroy", () => {
  const h = createDomHarness({ initialMode: "paused" });
  h.root.fire("pointerdown", { pointerId: 7, clientX: 0, clientY: 80, target: h.root });
  h.root.fire("pointercancel", { pointerId: 7, clientX: 0, clientY: 80, target: h.root });
  assert.equal(h.root.released, 7);
  const capturedWheel = h.root.listeners.get("wheel").listener;
  const capturedCardClick = h.root.children[0].children[0].listeners.get("click").listener;
  const progress = h.controller.snapshot().progress;
  h.controller.destroy();
  assert.doesNotThrow(() => capturedWheel({ deltaY: 100, preventDefault() {} }));
  assert.doesNotThrow(() => capturedCardClick());
  assert.equal(h.controller.snapshot().progress, progress);
  assert.equal(h.selected.length, 0);
});

test("throwing progress, selection and end consumers cannot break renderer state or cleanup", () => {
  const h = createDomHarness({ initialMode: "paused", callbacks: {
    onProgress() { throw Error("progress consumer"); },
    onSelect() { throw Error("select consumer"); },
    onEnd() { throw Error("end consumer"); },
  } });
  assert.doesNotThrow(() => h.root.children[0].children[0].fire("click"));
  assert.doesNotThrow(() => h.root.fire("wheel", { deltaY: 99999, preventDefault() {} }));
  assert.equal(h.controller.snapshot().mode, "ended");
  assert.equal(h.controller.destroy(), true);
});

test("RAF and resize exceptions are contained by rolling down all owned DOM resources", () => {
  const state = {
    progress: 0, mode: "cruising",
    snapshot() { return Object.freeze({ progress: this.progress, mode: this.mode }); },
    tick() { throw Error("tick failure"); }, nudge() { return false; }, pause() { return false; }, resume() { return false; }, startRewind() { return false; },
  };
  const raf = createDomHarness({ callbacks: { stateFactory: () => state } });
  assert.doesNotThrow(() => raf.frames.shift()(16));
  assert.equal(raf.root.children.length, 0);
  assert.equal(raf.root.listeners.size, 0);
  assert.equal(raf.windowListeners.size, 0);
  assert.equal(raf.controller.destroy(), false);

  const resize = createDomHarness({ initialMode: "paused" });
  const resizeHandler = resize.windowListeners.get("resize");
  Object.defineProperty(resize.root, "clientWidth", { get() { throw Error("resize failure"); } });
  assert.doesNotThrow(() => resizeHandler());
  assert.equal(resize.root.children.length, 0);
  assert.equal(resize.controller.destroy(), false);
});

test("each moving frame projects only the visible window and writes only changed card values", () => {
  const h = createDomHarness();
  h.metrics.styleWrites = 0; h.metrics.hiddenWrites = 0; h.metrics.hiddenTrue = 0; h.metrics.hiddenFalse = 0;
  h.frames.shift()(0);
  assert.deepEqual(h.metrics, { styleWrites: 0, hiddenWrites: 0, hiddenTrue: 0, hiddenFalse: 0 });

  h.metrics.styleWrites = 0; h.metrics.hiddenWrites = 0; h.metrics.hiddenTrue = 0; h.metrics.hiddenFalse = 0;
  h.frames.shift()(16);
  assert.ok(h.metrics.styleWrites <= 208);
  assert.ok(h.metrics.hiddenWrites <= 1);
  h.controller.destroy();
});

test("stationary repaint performs no repeated style or hidden writes and each leaving card hides once", () => {
  const h = createDomHarness({ initialMode: "paused" });
  h.metrics.styleWrites = 0; h.metrics.hiddenWrites = 0; h.metrics.hiddenTrue = 0; h.metrics.hiddenFalse = 0;
  h.windowListeners.get("resize")();
  assert.deepEqual(h.metrics, { styleWrites: 0, hiddenWrites: 0, hiddenTrue: 0, hiddenFalse: 0 });

  h.metrics.styleWrites = 0; h.metrics.hiddenWrites = 0; h.metrics.hiddenTrue = 0; h.metrics.hiddenFalse = 0;
  h.root.fire("wheel", { deltaY: 99999, preventDefault() {} });
  assert.equal(h.metrics.hiddenTrue, 92);
  assert.equal(h.metrics.hiddenFalse, 10);
  h.metrics.hiddenWrites = 0; h.metrics.hiddenTrue = 0; h.metrics.hiddenFalse = 0;
  h.windowListeners.get("resize")();
  assert.equal(h.metrics.hiddenWrites, 0);
  h.controller.destroy();
});

test("pointercancel clears suppression so the first following card click selects immediately", () => {
  const h = createDomHarness({ initialMode: "paused" });
  h.root.fire("pointerdown", { pointerId: 9, clientX: 0, clientY: 100, target: h.root });
  h.root.fire("pointermove", { pointerId: 9, clientX: 0, clientY: 70, target: h.root });
  h.root.fire("pointercancel", { pointerId: 9, clientX: 0, clientY: 70, target: h.root });
  h.root.children[0].children[4].fire("click");
  assert.equal(h.selected.length, 1);
  assert.equal(h.selected[0][0].order, 5);
  h.controller.destroy();
});

test("unexpected lost pointer capture clears drag suppression and preserves the next card click", () => {
  const h = createDomHarness({ initialMode: "paused" });
  h.root.fire("pointerdown", { pointerId: 11, clientX: 0, clientY: 100, target: h.root });
  h.root.fire("pointermove", { pointerId: 11, clientX: 0, clientY: 60, target: h.root });
  h.root.fire("lostpointercapture", { pointerId: 11, target: h.root });
  h.root.children[0].children[6].fire("click");
  assert.equal(h.selected.length, 1);
  assert.equal(h.selected[0][0].order, 7);
  h.controller.destroy();
});
