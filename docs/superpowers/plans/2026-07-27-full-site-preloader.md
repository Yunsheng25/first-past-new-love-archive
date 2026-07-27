# Full-Site Preloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在展示网站内容前，将全部公开素材载入浏览器缓存，并用与真实进度绑定的暗房显影影像长卷展示加载状态。

**Architecture:** 构建阶段由 Node 脚本扫描 `assets` 并生成包含路径与字节数的静态清单。浏览器端独立的预加载器以有限并发请求清单资源，发出不可变进度快照；加载页只消费这些快照，路由系统等全部成功后才挂载。视觉层与加载逻辑分离，失败重试和减少动态效果均可独立测试。

**Tech Stack:** 原生 ES modules、Fetch API、浏览器 HTTP Cache、Node.js test runner、CSS animations。

---

## File Structure

- Create `scripts/build-preload-manifest.mjs`: 扫描公开素材并生成稳定清单。
- Create `preload-manifest.js`: 构建产物，暴露路径、字节数与总量。
- Create `src/site-preloader.js`: 并发请求、字节进度、重试与取消。
- Create `src/preloader-ui.js`: 加载页 DOM、显影长卷、鼠标互动与完成淡出。
- Modify `index.html`: 在脚本执行前提供可见的加载页骨架。
- Modify `script.js`: 全量预载成功后才挂载现有网站路由。
- Modify `style.css`: 正式加载页视觉与动效。
- Modify `package.json`: 增加清单构建命令。
- Create `tests/preload-manifest.test.mjs`: 清单覆盖与稳定性测试。
- Create `tests/site-preloader.test.mjs`: 并发、进度、重试与失败测试。
- Create `tests/preloader-ui.test.mjs`: 加载页状态与完成行为测试。

### Task 1: Generate a complete, stable asset manifest

**Files:**
- Create: `tests/preload-manifest.test.mjs`
- Create: `scripts/build-preload-manifest.mjs`
- Create: `preload-manifest.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing manifest test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

test('preload manifest contains every public asset once with exact byte sizes', async () => {
  const source = await readFile('preload-manifest.js', 'utf8');
  const json = source.match(/Object\.freeze\((\[[\s\S]*\])\)/)?.[1];
  assert.ok(json, 'manifest array is exported');
  const entries = JSON.parse(json);
  assert.equal(new Set(entries.map(({ path }) => path)).size, entries.length);
  for (const entry of entries) {
    const info = await stat(entry.path);
    assert.equal(entry.bytes, info.size);
  }
  async function walk(dir) {
    const names = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(names.map((item) => item.isDirectory()
      ? walk(path.join(dir, item.name))
      : [path.join(dir, item.name).replaceAll('\\', '/')]
    ))).flat();
  }
  assert.deepEqual(entries.map(({ path }) => path), (await walk('assets')).sort());
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/preload-manifest.test.mjs`

Expected: FAIL because `preload-manifest.js` does not exist.

- [ ] **Step 3: Implement deterministic manifest generation**

`scripts/build-preload-manifest.mjs` recursively walks `assets`, sorts normalized paths, reads exact sizes, and writes:

```js
export const PRELOAD_ASSETS = Object.freeze([
  { "path": "assets/...", "bytes": 1234 }
]);
export const PRELOAD_TOTAL_BYTES = 1234;
```

Add:

```json
"build:preload": "node scripts/build-preload-manifest.mjs"
```

Generate `preload-manifest.js`.

- [ ] **Step 4: Run the manifest test and verify GREEN**

Run: `node --test tests/preload-manifest.test.mjs`

Expected: PASS with every file under `assets` represented exactly once.

- [ ] **Step 5: Commit**

Run:

```powershell
git add package.json scripts/build-preload-manifest.mjs preload-manifest.js tests/preload-manifest.test.mjs
git commit -m "feat: generate complete preload manifest"
```

### Task 2: Implement the full-site loading engine

**Files:**
- Create: `tests/site-preloader.test.mjs`
- Create: `src/site-preloader.js`

- [ ] **Step 1: Write failing behavioral tests**

Tests construct small real `Response` objects and assert that `preloadAssets()`:

```js
const snapshots = [];
await preloadAssets({
  assets: [{ path: 'a.jpg', bytes: 3 }, { path: 'b.mp4', bytes: 5 }],
  concurrency: 2,
  fetchImpl: async (path) => new Response(path === 'a.jpg' ? 'abc' : '12345'),
  onProgress: (state) => snapshots.push(state),
});
assert.equal(snapshots.at(-1).completedFiles, 2);
assert.equal(snapshots.at(-1).loadedBytes, 8);
assert.equal(snapshots.at(-1).percent, 100);
assert.equal(snapshots.at(-1).status, 'complete');
```

Additional tests assert: at most four active requests, one failed request is retried twice, terminal failure rejects with the failing path, abort stops new work, and progress snapshots are frozen and monotonic.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/site-preloader.test.mjs`

Expected: FAIL because `src/site-preloader.js` does not exist.

- [ ] **Step 3: Implement the minimal loader**

Export:

```js
export async function preloadAssets({
  assets,
  fetchImpl = fetch,
  concurrency = 4,
  retries = 2,
  signal,
  onProgress = () => {},
}) {}
```

Each worker calls `fetchImpl(path, { cache: 'force-cache', signal })`, rejects non-OK responses, consumes `response.body` when available, and otherwise uses `arrayBuffer()`. Progress credits at most the manifest byte size per resource so streamed server metadata cannot exceed 100%. Completed resources are released immediately rather than retained in JavaScript arrays.

- [ ] **Step 4: Run loader tests and verify GREEN**

Run: `node --test tests/site-preloader.test.mjs`

Expected: all loader tests PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/site-preloader.js tests/site-preloader.test.mjs
git commit -m "feat: preload every site asset"
```

### Task 3: Build the real-progress darkroom film UI

**Files:**
- Create: `tests/preloader-ui.test.mjs`
- Create: `src/preloader-ui.js`
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Write failing UI contract tests**

Assert that:

```js
const root = createPreloaderView(document);
updatePreloaderView(root, {
  percent: 68,
  loadedBytes: 347_200_000,
  totalBytes: 510_300_000,
  completedFiles: 138,
  totalFiles: 204,
  currentPath: 'assets/canvas-images/042.png',
});
assert.equal(root.querySelector('[data-preload-percent]').textContent, '68');
assert.match(root.querySelector('[data-preload-bytes]').textContent, /347\.2 MB/);
assert.equal(root.querySelectorAll('.preload-card.is-developed').length, 138);
```

Also assert that terminal failure exposes a retry button, completion marks the root as leaving, pointer movement updates CSS coordinates without selecting text, and reduced motion disables continuous travel.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test tests/preloader-ui.test.mjs`

Expected: FAIL because the UI module does not exist.

- [ ] **Step 3: Implement view creation and updates**

`createPreloaderView(document, { reducedMotion })` renders one diagonal film strip with enough cards to represent rolling progress, the real percentage, byte count, file count, current phase, retry area, and circular cursor. `updatePreloaderView()` maps completed-file ratio to developed cards. Pointer movement sets `--preload-pointer-x`, `--preload-pointer-y`, `--preload-parallax-x`, and `--preload-parallax-y`; CSS uses these for the darkroom ripple and subtle strip depth.

Add a static `#site-preloader` skeleton to `index.html` so the first paint never shows an unexplained black screen. Add scoped `.site-preloader`, `.preload-film`, `.preload-card`, `.preload-ripple`, and `.is-developed` rules to `style.css`.

- [ ] **Step 4: Run UI tests and verify GREEN**

Run: `node --test tests/preloader-ui.test.mjs`

Expected: all UI tests PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add index.html style.css src/preloader-ui.js tests/preloader-ui.test.mjs
git commit -m "feat: add darkroom film loading screen"
```

### Task 4: Gate the application behind successful full preload

**Files:**
- Modify: `script.js`
- Modify: `tests/site-shell.test.mjs`

- [ ] **Step 1: Write the failing boot-gate test**

Add assertions that `script.js` imports the manifest, loader, and UI, does not call `reviewTurnController.renderInitial()` before preload resolution, calls it exactly once after success, and wires retry to a new attempt.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --test tests/site-shell.test.mjs`

Expected: FAIL because the current script renders immediately.

- [ ] **Step 3: Implement the boot gate**

Move the existing final initial render into:

```js
async function bootSite() {
  await runFullSitePreload();
  reviewTurnController.renderInitial(currentRoute());
  await dismissPreloader();
}

void bootSite();
```

Keep hash parsing available during loading but do not render route content. On final failure, leave the loader visible and bind its retry control to a fresh `AbortController` and a fresh preload attempt.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `node --test tests/site-shell.test.mjs`

Expected: PASS.

- [ ] **Step 5: Run the complete suite**

Run: `npm.cmd test`

Expected: 0 failures.

- [ ] **Step 6: Commit**

Run:

```powershell
git add script.js tests/site-shell.test.mjs
git commit -m "feat: wait for full preload before site reveal"
```

### Task 5: Verify slow, cached, and failed loading paths

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Start the local preview**

Run: `npm.cmd run preview`

Expected: local URL is printed and remains available.

- [ ] **Step 2: Verify a cold load**

Open with cache disabled and network throttled. Confirm that the loader appears on first paint, progress and byte counts move forward, completed cards remain developed, and no route content appears before 100%.

- [ ] **Step 3: Verify a warm load**

Reload with browser cache enabled. Confirm that all resources are checked from cache and the loader completes substantially faster without duplicate app mounting.

- [ ] **Step 4: Verify terminal failure and retry**

Block one asset request, confirm the loader retries and then exposes a retry action. Unblock the request, click retry, and confirm the site enters exactly once.

- [ ] **Step 5: Verify responsive and reduced-motion behavior**

Check desktop and mobile widths. Enable reduced motion and confirm that the long roll is static while real progress and developed states remain understandable.

- [ ] **Step 6: Run fresh final verification**

Run:

```powershell
npm.cmd test
git diff --check
git status --short
```

Expected: full suite passes, diff has no whitespace errors, and only intentional files are modified.

