# 制作档案螺旋隧道 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将制作档案默认总览改为严格按 138 次图片出现顺序前进的 Three.js 螺旋隧道，保留列表模式，并提供完整案例弹层与末尾快速回溯。

**Architecture:** 数据层把 72 个案例展平为不可变的 138 occurrence 列表；纯状态机负责进度、惯性、90 秒漫游和 3.2 秒回溯；Three.js 只负责渲染当前纹理窗口。点击 occurrence 解析回所属案例并打开 DOM 弹层，列表模式复用现有筛选界面，WebGL/reduced-motion 失败时自动降级。

**Tech Stack:** 原生 ES Modules、Three.js r160（固定版本并本地 vendor）、WebGL、DOM/CSS 弹层、`node:test`、现有 `data/archive.json`。

---

## 文件结构

- Create: `src/archive-tunnel-data.js` — 138 occurrence 展平、案例分组和纯布局数学。
- Create: `src/archive-tunnel-state.js` — 漫游、手动进度、末尾和回溯状态机。
- Create: `src/archive-tunnel.js` — Three.js scene、纹理窗口、raycasting 和资源释放。
- Create: `src/archive-case-modal.js` — 居中案例卡片、1/2/9 图布局、焦点与复制。
- Create: `tests/archive-tunnel.test.mjs` — 顺序、布局、漫游、回溯和降级测试。
- Create: `tests/archive-case-modal.test.mjs` — 案例分组、首尾帧上下布局和导航测试。
- Create: `scripts/vendor-three.mjs` — 将固定版本 Three.js ESM 复制到静态目录。
- Create: `vendor/three.module.min.js` — 本地静态依赖。
- Create: `THIRD_PARTY_NOTICES.md` — TimeChannel 与 Three.js 的 MIT 归属。
- Modify: `package.json` / Create: `package-lock.json` — 固定 `three@0.160.1`。
- Modify: `src/archive-ui.js` — 默认隧道、列表切换、弹层连接和缓存。
- Modify: `style.css` — 隧道、控件、柔光、居中弹层、手机布局。
- Modify: `tests/archive-ui.test.mjs` — 新默认视图和现有列表回归。
- Modify: `tests/archive-data.test.mjs` — 锁定展平顺序与分组计数。

### Task 1: 固定 Three.js 与第三方归属

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `scripts/vendor-three.mjs`
- Create: `vendor/three.module.min.js`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `tests/site-data-entry.test.mjs`

- [ ] **Step 1: 写依赖与静态 vendor 的失败测试**

在 `tests/site-data-entry.test.mjs` 读取 `package.json`、vendor 文件和 notices：

```js
test('Three.js 固定版本可由静态站点加载并保留 MIT 归属', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const moduleSource = await readFile(new URL('../vendor/three.module.min.js', import.meta.url), 'utf8');
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  assert.equal(pkg.dependencies.three, '0.160.1');
  assert.match(moduleSource, /REVISION/);
  assert.match(notices, /Three\.js[\s\S]*MIT/);
  assert.match(notices, /FranzLy\/TimeChannel[\s\S]*MIT/);
});
```

- [ ] **Step 2: 运行并确认 vendor 文件不存在**

Run: `node --test tests/site-data-entry.test.mjs`
Expected: FAIL，`vendor/three.module.min.js` 不存在。

- [ ] **Step 3: 安装固定依赖并实现 vendor 脚本**

Run: `npm install --save-exact three@0.160.1`
Expected: `package.json` 和 `package-lock.json` 固定为 `0.160.1`。

在 `scripts/vendor-three.mjs` 写入：

```js
import { copyFile, mkdir } from 'node:fs/promises';
const destination = new URL('../vendor/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL('../node_modules/three/build/three.module.min.js', import.meta.url),
  new URL('three.module.min.js', destination),
);
```

Run: `node scripts/vendor-three.mjs`
Expected: 创建 `vendor/three.module.min.js`。

- [ ] **Step 4: 添加 `THIRD_PARTY_NOTICES.md`**

文件必须包含 Three.js r160 的 MIT copyright/license，以及 `FranzLy/TimeChannel`（Copyright 2026 Yu Li）的 MIT copyright/license；注明本项目只适配隧道布局、惯性控制和移动性能思路。

- [ ] **Step 5: 运行测试并提交依赖**

Run: `node --test tests/site-data-entry.test.mjs`
Expected: PASS。

```bash
git add package.json package-lock.json scripts/vendor-three.mjs vendor/three.module.min.js THIRD_PARTY_NOTICES.md tests/site-data-entry.test.mjs
git commit -m "build: vendor Three.js for the archive tunnel"
```

### Task 2: 锁定 occurrence 顺序和案例分组

**Files:**
- Create: `src/archive-tunnel-data.js`
- Create: `tests/archive-tunnel.test.mjs`
- Modify: `tests/archive-data.test.mjs`

- [ ] **Step 1: 写 138 顺序和 1/2/9 分组失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { flattenArchiveOccurrences, groupCaseImages, tunnelPose } from '../src/archive-tunnel-data.js';

const data = JSON.parse(await readFile(new URL('../data/archive.json', import.meta.url), 'utf8'));

test('隧道严格展平白板顺序并保留重复 occurrence', () => {
  const items = flattenArchiveOccurrences(data);
  assert.equal(items.length, 138);
  assert.equal(new Set(items.map((item) => item.src)).size, 137);
  assert.equal(items[0].src, data.cases[0].images[0].src);
  assert.equal(items.at(-1).src, data.cases.at(-1).images.at(-1).src);
  assert.deepEqual(items.map((item) => item.order), Array.from({ length: 138 }, (_, i) => i + 1));
});

test('案例媒体按完整案例分组', () => {
  const sizes = data.cases.map((item) => groupCaseImages(data, item.id).length);
  assert.equal(sizes.filter((size) => size === 1).length, 13);
  assert.equal(sizes.filter((size) => size === 2).length, 58);
  assert.equal(sizes.filter((size) => size === 9).length, 1);
});

test('布局产生有限长的螺旋纵深', () => {
  const first = tunnelPose(0);
  const ninth = tunnelPose(8);
  const last = tunnelPose(137);
  assert.ok(ninth.z < first.z);
  assert.ok(last.z < ninth.z);
  assert.ok(Math.abs(first.x - ninth.x) > 0.1);
});
```

- [ ] **Step 2: 运行并确认模块不存在**

Run: `node --test tests/archive-tunnel.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现不可变 occurrence 与布局**

在 `src/archive-tunnel-data.js`：

```js
export const TUNNEL_STEP = 0.52;
export const TUNNEL_RADIUS_X = 4.25;
export const TUNNEL_RADIUS_Y = 2.82;

export function flattenArchiveOccurrences(data) {
  return Object.freeze(data.cases.flatMap((caseItem) => caseItem.images.map((image) => Object.freeze({
    order: image.occurrence,
    caseId: caseItem.id,
    caseIndex: caseItem.index,
    title: caseItem.title,
    role: image.role,
    src: image.src,
  }))));
}

export function groupCaseImages(data, caseId) {
  return data.cases.find((item) => item.id === caseId)?.images ?? [];
}

export function tunnelPose(index) {
  const angle = index * (Math.PI * 2 / 8) + Math.floor(index / 8) * 0.22;
  return {
    x: Math.cos(angle) * TUNNEL_RADIUS_X,
    y: Math.sin(angle) * TUNNEL_RADIUS_Y,
    z: -index * TUNNEL_STEP,
    rotationZ: angle + Math.PI / 2,
  };
}
```

- [ ] **Step 4: 运行数据测试**

Run: `node --test tests/archive-tunnel.test.mjs tests/archive-data.test.mjs`
Expected: PASS；138/137/72 与当前签名一致。

- [ ] **Step 5: 提交数据层**

```bash
git add src/archive-tunnel-data.js tests/archive-tunnel.test.mjs tests/archive-data.test.mjs
git commit -m "feat: map archive images into tunnel order"
```

### Task 3: 实现 90 秒漫游与 3.2 秒回溯状态机

**Files:**
- Create: `src/archive-tunnel-state.js`
- Modify: `tests/archive-tunnel.test.mjs`

- [ ] **Step 1: 写状态转换失败测试**

```js
import { createTunnelState, TUNNEL_CRUISE_MS, TUNNEL_REWIND_MS } from '../src/archive-tunnel-state.js';

test('自动漫游 90 秒到末尾，回溯 3.2 秒回到入口', () => {
  const state = createTunnelState({ maxProgress: 137 });
  state.tick(TUNNEL_CRUISE_MS);
  assert.equal(state.snapshot().mode, 'ended');
  assert.equal(state.snapshot().progress, 137);
  state.startRewind();
  state.tick(TUNNEL_REWIND_MS / 2);
  assert.equal(state.snapshot().mode, 'rewinding');
  state.tick(TUNNEL_REWIND_MS / 2);
  assert.equal(state.snapshot().mode, 'paused');
  assert.equal(state.snapshot().progress, 0);
});
```

- [ ] **Step 2: 运行并确认状态模块不存在**

Run: `node --test tests/archive-tunnel.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现纯状态机**

```js
export const TUNNEL_CRUISE_MS = 90000;
export const TUNNEL_REWIND_MS = 3200;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const easeInOutCubic = (t) => t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;

export function createTunnelState({ maxProgress }) {
  let progress = 0;
  let mode = 'cruising';
  let rewindElapsed = 0;
  let rewindFrom = 0;
  return {
    tick(deltaMs) {
      if (mode === 'cruising') {
        progress = clamp(progress + maxProgress * deltaMs / TUNNEL_CRUISE_MS, 0, maxProgress);
        if (progress === maxProgress) mode = 'ended';
      } else if (mode === 'rewinding') {
        rewindElapsed = clamp(rewindElapsed + deltaMs, 0, TUNNEL_REWIND_MS);
        progress = rewindFrom * (1 - easeInOutCubic(rewindElapsed / TUNNEL_REWIND_MS));
        if (rewindElapsed === TUNNEL_REWIND_MS) { progress = 0; mode = 'paused'; }
      }
    },
    nudge(delta) { if (mode !== 'rewinding') { progress = clamp(progress + delta, 0, maxProgress); mode = progress === maxProgress ? 'ended' : 'paused'; } },
    resume() { if (mode !== 'rewinding' && progress < maxProgress) mode = 'cruising'; },
    pause() { if (mode === 'cruising') mode = 'paused'; },
    startRewind() { if (mode !== 'ended') return false; rewindFrom = progress; rewindElapsed = 0; mode = 'rewinding'; return true; },
    snapshot() { return Object.freeze({ progress, mode, maxProgress }); },
  };
}
```

- [ ] **Step 4: 测试滚轮边界、暂停和错误时序**

追加 `nudge(-999)` 不小于 0、`nudge(999)` 进入 ended、rewinding 时 nudge 无效、未到末尾不能回溯。

Run: `node --test tests/archive-tunnel.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交状态机**

```bash
git add src/archive-tunnel-state.js tests/archive-tunnel.test.mjs
git commit -m "feat: control archive cruise and rewind"
```

### Task 4: 实现可释放资源的 Three.js 隧道

**Files:**
- Create: `src/archive-tunnel.js`
- Modify: `tests/archive-tunnel.test.mjs`

- [ ] **Step 1: 写 renderer 契约失败测试**

以依赖注入的 fake renderer/scene 验证 `mountArchiveTunnel()` 返回 `{ pause, resume, startRewind, destroy, snapshot }`；`destroy()` 取消 RAF、移除 wheel/pointer 监听并 dispose geometry/material/texture，且可重复调用。

- [ ] **Step 2: 运行并确认模块不存在**

Run: `node --test tests/archive-tunnel.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现 renderer 的固定接口**

`src/archive-tunnel.js` 必须：

```js
import * as THREE from '../vendor/three.module.min.js';
import { flattenArchiveOccurrences, tunnelPose, TUNNEL_STEP } from './archive-tunnel-data.js';
import { createTunnelState } from './archive-tunnel-state.js';

export function mountArchiveTunnel(root, data, {
  onSelect = () => {}, onEnd = () => {}, onFallback = () => {},
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame,
  windowRef = window, three = THREE,
} = {}) {
  const noOpController = { pause() {}, resume() {}, startRewind() { return false; }, snapshot() { return null; }, destroy() {} };
  if (!root || !windowRef.WebGLRenderingContext) { onFallback('webgl-unavailable'); return noOpController; }
  const occurrences = flattenArchiveOccurrences(data);
  const state = createTunnelState({ maxProgress: occurrences.length - 1 });
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(46, root.clientWidth / root.clientHeight, 0.1, 120);
  const renderer = new three.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const loader = new three.TextureLoader();
  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2();
  renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 1.6));
  renderer.setSize(root.clientWidth, root.clientHeight);
  root.append(renderer.domElement);
  const geometry = new three.PlaneGeometry(1.82, 1.24);
  const meshes = occurrences.map((item, index) => {
    const material = new three.MeshBasicMaterial({ color: 0x262229, transparent: true, opacity: .92, side: three.DoubleSide });
    const mesh = new three.Mesh(geometry, material);
    const pose = tunnelPose(index);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.rotation.z = pose.rotationZ;
    mesh.userData = { index, occurrence: item, texture: null, loading: false };
    scene.add(mesh); return mesh;
  });
  const mobile = windowRef.matchMedia?.('(max-width: 760px)').matches ?? false;
  const textureRadius = mobile ? 18 : 32;
  let destroyed = false;
  let frameId = null;
  let previousTime = null;
  let endedAnnounced = false;
  let drag = null;

  const unloadTexture = (mesh) => {
    mesh.userData.texture?.dispose?.();
    mesh.userData.texture = null;
    mesh.userData.loading = false;
    mesh.material.map = null;
    mesh.material.color.setHex(0x262229);
    mesh.material.needsUpdate = true;
  };
  const loadTexture = (mesh) => {
    if (mesh.userData.texture || mesh.userData.loading) return;
    mesh.userData.loading = true;
    loader.load(mesh.userData.occurrence.src, (texture) => {
      if (destroyed) { texture.dispose(); return; }
      texture.colorSpace = three.SRGBColorSpace;
      mesh.userData.loading = false;
      mesh.userData.texture = texture;
      mesh.material.map = texture;
      mesh.material.color.setHex(0xffffff);
      mesh.material.needsUpdate = true;
    }, undefined, () => { mesh.userData.loading = false; });
  };
  const updateTextureWindow = (progress) => {
    const center = Math.round(progress);
    meshes.forEach((mesh, index) => {
      if (Math.abs(index - center) <= textureRadius) loadTexture(mesh);
      else if (mesh.userData.texture) unloadTexture(mesh);
    });
  };
  const resize = () => {
    if (destroyed || !root.clientWidth || !root.clientHeight) return;
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(root.clientWidth, root.clientHeight);
  };
  const selectAt = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) { state.pause(); onSelect(hit.object.userData.occurrence, hit.object); }
  };
  const wheel = (event) => { event.preventDefault(); state.nudge(event.deltaY * 0.012); };
  const pointerDown = (event) => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, moved: false }; renderer.domElement.setPointerCapture?.(event.pointerId); };
  const pointerMove = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = drag.lastY - event.clientY;
    drag.lastY = event.clientY;
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6;
    if (delta) state.nudge(delta * 0.05);
  };
  const pointerUp = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const shouldSelect = !drag.moved;
    drag = null;
    if (shouldSelect) selectAt(event);
  };
  const render = (time) => {
    if (destroyed) return;
    const delta = previousTime === null ? 0 : Math.min(64, time - previousTime);
    previousTime = time;
    state.tick(delta);
    const snapshot = state.snapshot();
    camera.position.set(0, 0, 3 - snapshot.progress * TUNNEL_STEP);
    camera.lookAt(0, 0, camera.position.z - 4);
    updateTextureWindow(snapshot.progress);
    if (snapshot.mode === 'ended' && !endedAnnounced) { endedAnnounced = true; onEnd(snapshot); }
    if (snapshot.mode !== 'ended') endedAnnounced = false;
    renderer.render(scene, camera);
    frameId = requestFrame(render);
  };
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  windowRef.addEventListener('resize', resize);
  resize();
  frameId = requestFrame(render);

  return {
    pause: () => state.pause(),
    resume: () => state.resume(),
    startRewind: () => state.startRewind(),
    snapshot: () => state.snapshot(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId !== null) cancelFrame(frameId);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      windowRef.removeEventListener('resize', resize);
      meshes.forEach((mesh) => { unloadTexture(mesh); mesh.material.dispose(); scene.remove(mesh); });
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

纹理窗口只保留当前 occurrence 前后各 32 张；移动端前后各 18 张。相机 z 使用 `3 - progress * TUNNEL_STEP`。

- [ ] **Step 4: 添加淡光而非条纹背景**

在 scene 创建后加入雾，并给 canvas 容器添加纯 CSS 柔光 class；不得创建放射线几何体、旋转光束或 `repeating-conic-gradient`：

```js
scene.fog = new three.FogExp2(0x09070c, 0.032);
root.classList.add('archive-tunnel-surface');
```

```css
.archive-tunnel-surface {
  background:
    radial-gradient(ellipse at 27% 24%, rgba(176, 144, 184, .12), transparent 31%),
    radial-gradient(ellipse at 76% 73%, rgba(108, 128, 151, .09), transparent 33%),
    radial-gradient(ellipse at 50% 52%, #000 0 7%, #17131b 48%, #050507 112%);
}
```

- [ ] **Step 5: 运行测试并提交 renderer**

Run: `node --test tests/archive-tunnel.test.mjs`
Expected: PASS；dispose 计数与创建计数一致。

```bash
git add src/archive-tunnel.js tests/archive-tunnel.test.mjs
git commit -m "feat: render the ordered archive tunnel"
```

### Task 5: 实现完整案例居中弹层

**Files:**
- Create: `src/archive-case-modal.js`
- Create: `tests/archive-case-modal.test.mjs`

- [ ] **Step 1: 写 1/2/9 图与首尾上下失败测试**

```js
import { buildArchiveCaseModal, resolveCaseFromOccurrence } from '../src/archive-case-modal.js';

test('点击首帧或尾帧都打开上下排列的完整双图案例', () => {
  const occurrence = { caseId: 'case-01', order: 1 };
  const item = resolveCaseFromOccurrence(data, occurrence);
  const html = buildArchiveCaseModal(item, occurrence);
  assert.equal(item.images.length, 2);
  assert.match(html, /data-case-gallery="two"/);
  assert.ok(html.indexOf('首帧') < html.indexOf('尾帧'));
  assert.match(html, /data-case-image-role="首帧"/);
  assert.match(html, /data-case-image-role="尾帧"/);
});
```

- [ ] **Step 2: 运行并确认模块不存在**

Run: `node --test tests/archive-case-modal.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现弹层 HTML 与案例导航**

`buildArchiveCaseModal()` 生成 `role="dialog" aria-modal="true"` 的居中卡片：底板 `data-case-modal`；图库 class 为 one/two/many；图片保持原 src 与 100% opacity；two 按数组顺序上下渲染；many 为 3×3；完整 prompt 用 `<p>`；按钮为复制、上一个案例、下一个案例、关闭。

```js
export function resolveCaseFromOccurrence(data, occurrence) {
  return data.cases.find((item) => item.id === occurrence.caseId) ?? null;
}

export function caseNeighbor(data, caseId, delta) {
  const index = data.cases.findIndex((item) => item.id === caseId);
  return data.cases[index + delta] ?? null;
}
```

交互绑定必须 focus trap；`Esc` 关闭；关闭后恢复传入的 trigger focus；复制复用现有 clipboard fallback 逻辑；切换前后案例不关闭弹层。

- [ ] **Step 4: 运行测试并提交弹层**

Run: `node --test tests/archive-case-modal.test.mjs tests/archive-ui.test.mjs`
Expected: PASS。

```bash
git add src/archive-case-modal.js tests/archive-case-modal.test.mjs
git commit -m "feat: open complete archive cases in place"
```

### Task 6: 将隧道设为默认并保留列表降级

**Files:**
- Modify: `src/archive-ui.js`
- Modify: `style.css`
- Modify: `tests/archive-ui.test.mjs`

- [ ] **Step 1: 写默认隧道与列表切换失败测试**

断言 `buildArchiveIndexShell()` 含 `[data-archive-tunnel]`、`[data-archive-view="list"]`、自动漫游按钮、001/138 计数和末尾回溯按钮；reduced motion 或 `onFallback` 会渲染现有 `buildArchiveIndex()`。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/archive-ui.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 增加档案壳层并缓存数据**

`mountArchiveRoute()` 成功载入后保存模块级 archive data。`archive-index` 默认渲染隧道壳层并调用 `mountArchiveTunnel()`；点击列表模式销毁 renderer 后渲染现有列表；从列表返回隧道时恢复存储在 session state 的 progress。

```js
export function buildArchiveIndexShell(summary) {
  return `<section class="archive-tunnel-view app-view">
    <header class="archive-tunnel-header"><a href="#" class="archive-wordmark">初恋 · 旧爱 · 新欢</a>
      <div><button data-archive-view="list">列表模式</button><button data-tunnel-cruise>暂停漫游</button></div>
    </header>
    <div class="archive-tunnel-stage" data-archive-tunnel aria-label="按制作顺序排列的图片隧道"></div>
    <div class="archive-tunnel-count"><b data-tunnel-current>001</b> / ${summary.imageOccurrences}</div>
    <button class="archive-rewind" data-tunnel-rewind hidden>↶ 快速回溯</button>
    <div data-archive-modal-host></div>
    <a class="archive-return-after" href="#after">← 返回片后</a>
  </section>`;
}
```

- [ ] **Step 4: 连接选择、末尾和回溯**

`onSelect(occurrence)` 暂停隧道并挂载完整案例弹层；关闭恢复相同 progress。`onEnd` 显示中心回溯按钮；点击调用 `startRewind()` 并在 3.2 秒完成后隐藏。正式代码不得包含 Demo 的“预览末尾”。

- [ ] **Step 5: 添加已确认视觉 CSS**

核心约束：背景近黑平滑 radial gradients；无条纹；层距由 Three 坐标决定；中心弹层底板 `rgba(18,16,21,.44)`，外围 dim `rgba(2,1,5,.06)`；图片 opacity 1；双图 `.case-gallery[data-layout="two"]` 为单列两行；手机弹层上下布局。

- [ ] **Step 6: 运行测试并提交集成**

Run: `node --test tests/archive-ui.test.mjs tests/archive-case-modal.test.mjs tests/archive-tunnel.test.mjs`
Expected: PASS。

```bash
git add src/archive-ui.js style.css tests/archive-ui.test.mjs
git commit -m "feat: make the tunnel the archive overview"
```

### Task 7: 降级、响应式、内容锁与真实浏览器验收

**Files:**
- Modify: `tests/responsive-layout.test.mjs`
- Modify: `src/archive-tunnel.js`
- Modify: `src/archive-tunnel-state.js`
- Modify: `src/archive-case-modal.js`
- Modify: `src/archive-ui.js`
- Modify: `style.css`

- [ ] **Step 1: 自动化降级测试**

验证 WebGL 不可用调用一次 fallback；reduced motion 默认列表；图片加载失败仍保留 occurrence；destroy 后 RAF/监听不再运行；列表搜索筛选仍通过所有旧测试。

- [ ] **Step 2: 重建数据并验证内容签名**

Run: `npm run build:data`
Expected: 72 cases、138 occurrences、137 unique；13 单图、58 双图、1 九图；首尾路径与当前数据一致。
Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 3: 桌面浏览器完整路径验收**

验证约 90 秒自动漫游、滚轮/拖动暂停、点击 occurrence 打开正确案例、首尾上下、图片不褪色、复制、案例前后切换、关闭原位、末尾 3.2 秒回溯、列表往返保留进度、路由离开后资源释放。

- [ ] **Step 4: 手机与低性能验收**

验证触摸惯性、较小纹理窗口、弹层上下布局、无横向溢出；开启 reduced motion 或模拟 WebGL 失败时可靠进入列表模式。

- [ ] **Step 5: 检查许可证与正式 UI**

确认 `THIRD_PARTY_NOTICES.md` 完整；正式页面没有“预览末尾”、调试计数或 Demo 文案；无 `repeating-conic-gradient` 和旋转光束。

- [ ] **Step 6: 提交验收修正**

```bash
git add src/archive-tunnel.js src/archive-tunnel-state.js src/archive-case-modal.js src/archive-ui.js style.css tests/responsive-layout.test.mjs THIRD_PARTY_NOTICES.md
git commit -m "test: verify archive tunnel integrity"
```
