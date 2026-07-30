# Route-Complete Media Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never reveal the prompt tunnel or a target review spread until every image required for that experience is downloaded and decoded.

**Architecture:** Generate lightweight WebP display derivatives while retaining original files for detail views. Add a route-scoped loader that reports real byte/item progress, retries failed assets, and only mounts the visual route after readiness; review pages use the same primitive for the target spread.

**Tech Stack:** Python Pillow for build-time image derivatives, ES modules, browser Image decode API, Node built-in test runner.

---

## File Structure

- `scripts/build-tunnel-derivatives.py`: reproducible WebP derivative generation.
- `scripts/build-archive-data.mjs`: attach derivative and original image URLs.
- `assets/archive-display/`: generated route-display WebP assets.
- `src/route-media-loader.js`: route-scoped image preload/decode state machine.
- `src/route-loading-type.js`: shared B “文字苏醒” loading screen for archive and review routes.
- `src/archive-ui.js`: full archive preparation screen and retry.
- `src/archive-tunnel.js`: use decoded display URLs only.
- `src/review-reader.js`: prepare target spread media before turning.
- `src/preloader-ui.js`: shared progress presentation.
- `tests/tunnel-derivatives.test.mjs`: derivative build contract.
- `tests/route-media-loader.test.mjs`: all-ready, progress, retry, cancellation.
- `tests/archive-ui.test.mjs`: route remains hidden until ready.
- `tests/archive-tunnel.test.mjs`: display/original URL separation.
- `tests/review-reader-ui.test.mjs`: target-spread readiness.

### Task 1: Generate bounded WebP tunnel derivatives

**Files:**
- Create: `scripts/build-tunnel-derivatives.py`
- Create: `tests/tunnel-derivatives.test.mjs`
- Generate: `assets/archive-display/*.webp`

- [ ] **Step 1: Write the failing derivative test**

```js
test('derivative builder emits one bounded WebP per archive image', async () => {
  const result = spawnSync('python', ['scripts/build-tunnel-derivatives.py', '--check'], {
    cwd: projectRoot, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.count, 137);
  assert.ok(manifest.totalBytes <= 55 * 1024 * 1024);
  assert.ok(manifest.items.every((item) => item.width <= 1280 && item.format === 'WEBP'));
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/tunnel-derivatives.test.mjs`  
Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement deterministic conversion**

```py
from PIL import Image

def convert(source, target):
    with Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, "WEBP", quality=86, method=6)
```

Read archive image paths in source order, preserve a stable numbered filename, and make `--check` print count, dimensions, format, and total bytes as JSON.

- [ ] **Step 4: Generate and verify**

Run: `python scripts/build-tunnel-derivatives.py && node --test tests/tunnel-derivatives.test.mjs`  
Expected: 137 WebP files, total display payload at or below 55 MB, test PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-tunnel-derivatives.py tests/tunnel-derivatives.test.mjs assets/archive-display
git commit -m "perf: generate tunnel display derivatives"
```

### Task 2: Preserve original and display URLs in archive data

**Files:**
- Modify: `scripts/build-archive-data.mjs`
- Modify: `data/archive.json`
- Modify: `tests/archive-data.test.mjs`

- [ ] **Step 1: Add the failing data contract**

```js
test('every tunnel occurrence has a display image and keeps the original', () => {
  for (const occurrence of data.occurrences) {
    assert.match(occurrence.displaySrc, /^assets\/archive-display\/.+\.webp$/);
    assert.match(occurrence.originalSrc, /^assets\//);
  }
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/archive-data.test.mjs`  
Expected: FAIL because `displaySrc` and `originalSrc` are absent.

- [ ] **Step 3: Extend the archive builder**

```js
occurrence.originalSrc = occurrence.src;
occurrence.displaySrc = `assets/archive-display/${String(index + 1).padStart(3, '0')}.webp`;
```

Keep `src` for backward compatibility until all callers use the explicit fields.

- [ ] **Step 4: Rebuild and test**

Run: `npm run build:data && node --test tests/archive-data.test.mjs`  
Expected: PASS with source order unchanged.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-archive-data.mjs data/archive.json tests/archive-data.test.mjs
git commit -m "feat: add archive display image manifest"
```

### Task 3: Route-scoped image download and decode controller

**Files:**
- Create: `src/route-media-loader.js`
- Create: `tests/route-media-loader.test.mjs`

- [ ] **Step 1: Write failing all-ready and retry tests**

```js
test('loader resolves only after every image has loaded and decoded', async () => {
  const events = [];
  const loader = createRouteMediaLoader({
    createImage: () => fakeDecodedImage(),
    onProgress: (progress) => events.push(progress),
  });
  const result = await loader.load(['a.webp', 'b.webp']);
  assert.equal(result.ready, 2);
  assert.equal(events.at(-1).ratio, 1);
});

test('loader retries a failed item and never reports ready early', async () => {
  let attempts = 0;
  const loader = createRouteMediaLoader({
    createImage: () => attempts++ === 0 ? fakeFailedImage() : fakeDecodedImage(),
    retries: 2,
  });
  assert.equal((await loader.load(['a.webp'])).ready, 1);
  assert.equal(attempts, 2);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/route-media-loader.test.mjs`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement download, decode, progress, retry and cancellation**

```js
async function decodeOne(src, createImage, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const image = createImage();
  image.src = src;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  await image.decode?.();
  return src;
}
```

Limit concurrency to six items, update progress only after decode, retry twice with a bounded backoff, and expose `abort()`.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/route-media-loader.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/route-media-loader.js tests/route-media-loader.test.mjs
git commit -m "feat: preload and decode complete route media"
```

### Task 4: Gate the tunnel behind real completion

**Files:**
- Create: `src/route-loading-type.js`
- Modify: `src/archive-ui.js`
- Modify: `src/archive-tunnel.js`
- Modify: `src/preloader-ui.js`
- Create: `tests/route-loading-type.test.mjs`
- Modify: `tests/archive-ui.test.mjs`
- Modify: `tests/archive-tunnel.test.mjs`

- [ ] **Step 1: Add failing route-gate tests**

```js
test('tunnel mount remains on preparation screen until all display images decode', async () => {
  const request = deferred();
  mountArchiveRoute(app, route, { prepareImages: () => request.promise });
  assert.match(app.innerHTML, /data-route-loading-type/);
  assert.match(app.innerHTML, /画面就绪/);
  assert.doesNotMatch(app.innerHTML, /data-archive-tunnel/);
  request.resolve({ ready: 137 });
  await flush();
  assert.match(app.innerHTML, /data-archive-tunnel/);
});
```

- [ ] **Step 2: Run the archive tests**

Run: `node --test tests/archive-ui.test.mjs tests/archive-tunnel.test.mjs`  
Expected: FAIL because the route currently mounts before decode completion.

- [ ] **Step 3: Add the preparation view**

```js
export function buildRouteLoadingType({ route, ready = 0, total, failed = 0 }) {
  const review = route === 'review';
  const word = review ? '手记就绪' : '画面就绪';
  return `<section class="route-loading-type" data-route-loading-type aria-live="polite">
    <small>${review ? 'THE MAKING-OF NOTES' : 'PROMPT & IMAGE ARCHIVE'}</small>
    <h1 aria-label="${word}">${[...word].map((character, index) =>
      `<span style="--character-index:${index}">${character}</span>`).join('')}</h1>
    <progress max="${total}" value="${ready}"></progress>
    <strong data-route-loading-progress>${String(ready).padStart(3, '0')} / ${total}</strong>
    <ol data-route-loading-stages>
      <li>读取目录</li><li>下载素材</li><li>解码画面</li><li>准备进入</li>
    </ol>
    ${failed ? `<button type="button" data-route-loading-retry>重新加载失败的 ${failed} 项</button>` : ''}
  </section>`;
}
```

Characters reveal from bottom to top as real overall progress advances. There is no explanatory subtitle below the four large characters. The count and progress element only advance after real download and decode completion. After readiness, briefly show the completed word and mount the tunnel with `occurrence.displaySrc`; case detail and lightbox use `occurrence.originalSrc`. On persistent failure, keep the loading screen visible and retry only failed URLs.

- [ ] **Step 4: Run archive tests**

Run: `node --test tests/route-loading-type.test.mjs tests/archive-ui.test.mjs tests/archive-tunnel.test.mjs tests/preloader-ui.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/route-loading-type.js src/archive-ui.js src/archive-tunnel.js src/preloader-ui.js tests/route-loading-type.test.mjs tests/archive-ui.test.mjs tests/archive-tunnel.test.mjs
git commit -m "feat: reveal tunnel only after complete preparation"
```

### Task 5: Prepare review spread media before page turn

**Files:**
- Modify: `src/review-reader-interactions.js`
- Modify: `src/review-reader.js`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Add a failing turn-readiness test**

```js
test('page turn waits for target spread media readiness', async () => {
  const ready = deferred();
  const moves = [];
  const turn = createReviewTurnCoordinator({
    prepare: () => ready.promise,
    navigate: (href) => moves.push(href),
  });
  const pending = turn.to('#review/production/5', ['frame.png']);
  assert.deepEqual(moves, []);
  ready.resolve({ ready: 1 });
  await pending;
  assert.deepEqual(moves, ['#review/production/5']);
});

test('cold review entry uses the manuscript word reveal until the first spread is ready', () => {
  const html = buildRouteLoadingType({ route: 'review', ready: 0, total: 8 });
  assert.match(html, /data-route-loading-type/);
  assert.match(html, /手记就绪/);
  assert.doesNotMatch(html, /所有资源准备完成后/);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-reader-ui.test.mjs`  
Expected: FAIL because turn coordination does not exist.

- [ ] **Step 3: Gate the turn animation**

```js
export function createReviewTurnCoordinator({ prepare, navigate }) {
  return {
    async to(href, urls) {
      await prepare(urls);
      navigate(href);
    },
  };
}
```

On cold review entry, show the same B word-reveal screen with review-specific copy until the first spread is ready. For later turns, keep the reader visible, collect images from the target spread, decode them, fetch video metadata without downloading full video files, then run the existing paper-turn animation and route update.

- [ ] **Step 4: Run reader tests**

Run: `node --test tests/review-reader-ui.test.mjs tests/route-media-loader.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review-reader-interactions.js src/review-reader.js tests/review-reader-ui.test.mjs
git commit -m "perf: prepare review media before page turns"
```

### Task 6: Full build and browser verification

**Files:**
- Modify: `tests/browser-cdp.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-30-route-complete-media-design.md`

- [ ] **Step 1: Add a browser smoke assertion**

```js
assert.equal(await page.locator('[data-archive-tunnel]').count(), 0);
await page.waitForSelector('[data-archive-preparing]');
await page.waitForSelector('[data-archive-tunnel]');
assert.equal(await page.locator('.archive-tunnel-card img:not([complete])').count(), 0);
```

- [ ] **Step 2: Run full automated verification**

Run: `npm run build:data && npm run build:preload && npm test`  
Expected: all tests PASS.

- [ ] **Step 3: Run size verification**

Run: `python scripts/build-tunnel-derivatives.py --check`  
Expected: 137 display images and total payload at or below 55 MB.

- [ ] **Step 4: Run local browser verification**

Run: `npm run preview` and verify:

1. the tunnel is never visible with missing cards;
2. progress reaches 137 / 137 before reveal;
3. a case opens its original-resolution image;
4. retry recovers from a simulated failed image;
5. review turns do not reveal undecoded images.

- [ ] **Step 5: Commit**

```bash
git add tests/browser-cdp.test.mjs docs/superpowers/specs/2026-07-30-route-complete-media-design.md
git commit -m "test: verify complete route media readiness"
```
