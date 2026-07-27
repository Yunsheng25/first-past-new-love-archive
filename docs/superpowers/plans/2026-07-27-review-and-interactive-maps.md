# Review Reader and Interactive Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a spacious desktop review reader with a compact article index and physical page-turn animation, replace the prompt archive’s false category tree with a chronological process path, and turn the review’s summary images into draggable interactive maps.

**Architecture:** Keep the existing vanilla JavaScript route and data-loading architecture. Add small focused modules for the article rail, physical page turn, process-graph modeling, and review live-map overlays; reuse existing camera, modal, focus-trap, and media rendering utilities. Source ordering remains authoritative, and all new navigation is layered over the existing `review.json`, `archive.json`, and canvas records without mutating their media order.

**Tech Stack:** ES modules, semantic HTML, CSS transforms/animations, SVG paths, Node’s built-in test runner, existing static JSON assets.

---

## File Structure

- Create `src/review-rail.js`: derive rail items and build the compact desktop index.
- Create `src/review-paper-turn.js`: clone/sanitize the outgoing paper and animate it over the already-rendered next page.
- Modify `src/review-reader.js`: mount the rail and live-map entry points without changing block order.
- Create `src/review-live-map-model.js`: map summary-image refs to stable hierarchical node data.
- Create `src/review-live-map.js`: full-screen canvas, pan/zoom, expand, detail, reset, overview, close.
- Rewrite `src/archive-mindmap-model.js`: chronological mainline with error detours and rejoin edges.
- Modify `src/archive-mindmap.js`: render process nodes, route branches, and retained camera controls.
- Modify `src/review-turn.js`: delegate eligible review navigation to the physical paper controller.
- Modify `style.css`: scoped ink-gray reader, article rail, physical sheet, process path, and live-map styles.
- Add `tests/review-rail.test.mjs`, `tests/review-paper-turn.test.mjs`, `tests/review-live-map.test.mjs`.
- Update `tests/review-reader-ui.test.mjs`, `tests/archive-mindmap-model.test.mjs`, `tests/archive-mindmap.test.mjs`, and `tests/responsive-layout.test.mjs`.

### Task 1: Lock the review content invariants

**Files:**
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Add failing invariants for the redesigned reader**

```js
test('desktop reader uses a compact rail without changing source blocks', () => {
  const target = normalizeReviewTarget(reviewData, reviewData.chapters[2].slug, 1);
  const html = buildReviewPage(reviewData, target);
  assert.match(html, /data-review-rail/);
  assert.doesNotMatch(html, /class="review-chapter-sidebar"/);
  assert.deepEqual(renderedBlockSignature(html), sourceBlockSignature(target.page.blocks));
});

test('review summary images keep their original position and gain only a live-map trigger', () => {
  const html = renderAllReviewPages(reviewData);
  assert.match(html, /data-review-live-map="image-generation"/);
  assert.match(html, /010-Pasted image 20260620133330\.png/);
  assert.equal(mediaSignature(html), mediaSignatureFromData(reviewData));
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/review-reader-ui.test.mjs`

Expected: FAIL because `data-review-rail` and `data-review-live-map` do not exist and the desktop sidebar still renders.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/review-reader-ui.test.mjs
git commit -m "test: lock review redesign content invariants"
```

### Task 2: Add the compact article rail

**Files:**
- Create: `src/review-rail.js`
- Create: `tests/review-rail.test.mjs`
- Modify: `src/review-reader.js`
- Modify: `style.css`

- [ ] **Step 1: Write the rail model tests**

```js
test('rail emits long chapter, medium case, and short page ticks in source order', () => {
  const items = buildReviewRail(reviewData, { chapterSlug: chapter.slug, page: 2 });
  assert.equal(items[0].kind, 'chapter');
  assert.ok(items.some((item) => item.kind === 'case'));
  assert.ok(items.some((item) => item.kind === 'page'));
  assert.equal(items.filter((item) => item.current).length, 1);
  assert.deepEqual(items.map((item) => item.order), [...items.map((item) => item.order)].sort((a, b) => a - b));
});
```

- [ ] **Step 2: Run the rail test and verify it fails**

Run: `node --test tests/review-rail.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the rail model and markup**

```js
export function buildReviewRail(data, target) {
  let order = 0;
  return data.chapters.flatMap((chapter) => chapter.pages.map((page, index) => ({
    id: `${chapter.slug}-${page.number}`,
    order: order++,
    kind: index === 0 ? 'chapter' : page.blocks.some((block) => block.type === 'callout') ? 'case' : 'page',
    label: index === 0 ? chapter.title : page.sectionTitle || `第 ${page.number} 页`,
    href: `#review/${chapter.slug}/${page.number}`,
    current: chapter.slug === target.chapter.slug && page.number === target.page.number,
  })));
}

export function reviewRailMarkup(items) {
  return `<nav class="review-rail" data-review-rail aria-label="全文索引">${items.map((item) =>
    `<a class="review-rail-tick is-${item.kind}${item.current ? ' is-current' : ''}" href="${item.href}" data-review-direction="jump"><span>${escapeRailLabel(item.label)}</span></a>`
  ).join('')}</nav>`;
}
```

- [ ] **Step 4: Mount the rail beside the paper and remove only the desktop sidebar**

In `buildReviewPage`, place `reviewRailMarkup(buildReviewRail(data, target))` before `.review-paper`; keep the existing mobile chapter drawer.

- [ ] **Step 5: Add the ink-gray wide reader rules**

```css
@media (min-width: 801px) {
  .review-reader-layout { grid-template-columns: 74px minmax(0, 1fr); }
  .review-chapter-sidebar { display: none; }
  .review-paper-content { width: min(1180px, calc(100% - 9vw)); }
  .review-paragraph { font-size: clamp(19px, 1.22vw, 21px); line-height: 1.95; }
}
.review-paper { background: #151719; color: #e5e4df; border-color: #303338; }
.review-rail-tick.is-chapter { width: 38px; }
.review-rail-tick.is-case { width: 18px; }
.review-rail-tick.is-page { width: 8px; }
```

- [ ] **Step 6: Run focused and responsive tests**

Run: `node --test tests/review-rail.test.mjs tests/review-reader-ui.test.mjs tests/responsive-layout.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/review-rail.js src/review-reader.js style.css tests/review-rail.test.mjs tests/review-reader-ui.test.mjs tests/responsive-layout.test.mjs
git commit -m "feat: widen review reader with compact article rail"
```

### Task 3: Replace the snapshot transition with a physical paper turn

**Files:**
- Create: `src/review-paper-turn.js`
- Create: `tests/review-paper-turn.test.mjs`
- Modify: `src/review-turn.js`
- Modify: `style.css`

- [ ] **Step 1: Write controller tests**

```js
test('paper turn renders the destination below a sanitized outgoing sheet', async () => {
  const harness = createTurnHarness();
  const controller = createReviewPaperTurn(harness.options);
  controller.turn(nextRoute, 'next');
  assert.equal(harness.renderedRoute, nextRoute);
  assert.equal(harness.stage.querySelectorAll('[id]').length, 0);
  assert.match(harness.stage.className, /is-turning-next/);
  harness.finishAnimation();
  assert.equal(harness.stage.isConnected, false);
});

test('rapid turns keep only the latest pending route', () => {
  const harness = createTurnHarness();
  const controller = createReviewPaperTurn(harness.options);
  controller.turn(route2, 'next');
  controller.turn(route3, 'next');
  harness.finishAnimation();
  assert.equal(harness.lastRenderedRoute, route3);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/review-paper-turn.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement a sanitized physical sheet**

```js
export function createTurnSheet(paper, documentRef) {
  const stage = documentRef.createElement('div');
  stage.className = 'review-paper-turn-stage';
  const sheet = documentRef.createElement('div');
  sheet.className = 'review-paper-turn-sheet';
  const front = paper.cloneNode(true);
  front.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  front.querySelectorAll('video').forEach((video) => { video.pause?.(); video.removeAttribute('autoplay'); });
  front.inert = true;
  const back = documentRef.createElement('div');
  back.className = 'review-paper-turn-back';
  sheet.append(front, back);
  stage.append(sheet);
  return stage;
}
```

- [ ] **Step 4: Render the destination first, then animate the outgoing sheet**

`createReviewPaperTurn.turn(route, direction)` must clone the current `.review-paper`, render the new route underneath, append the stage, set `is-turning-next` or `is-turning-previous`, and remove the stage on `animationend` or a 1600ms timeout.

- [ ] **Step 5: Add the physical page CSS**

```css
.review-paper-turn-stage { position: fixed; inset: var(--turn-paper-rect); z-index: 80; perspective: 2200px; pointer-events: none; }
.review-paper-turn-sheet { position: absolute; inset: 0; transform-origin: left center; transform-style: preserve-3d; }
.review-paper-turn-back { position: absolute; inset: 0; transform: rotateY(180deg); backface-visibility: hidden; background: linear-gradient(90deg, #101214, #222529 18%, #17191b); }
.is-turning-next .review-paper-turn-sheet { animation: review-real-turn 1.25s cubic-bezier(.32,.02,.18,1) forwards; }
@keyframes review-real-turn {
  0% { transform: rotateY(0) translateZ(0); }
  48% { transform: rotateY(-88deg) translateZ(34px) skewY(-1deg); }
  100% { transform: rotateY(-180deg) translateZ(0); }
}
```

Add moving fold-light and fold-shadow pseudo-elements. Under `prefers-reduced-motion`, skip the sheet and render immediately.

- [ ] **Step 6: Run review tests**

Run: `node --test tests/review-paper-turn.test.mjs tests/review-reader-ui.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/review-paper-turn.js src/review-turn.js style.css tests/review-paper-turn.test.mjs tests/review-reader-ui.test.mjs
git commit -m "feat: add physical review page turn"
```

### Task 4: Build the chronological prompt process graph

**Files:**
- Rewrite: `src/archive-mindmap-model.js`
- Modify: `tests/archive-mindmap-model.test.mjs`

- [ ] **Step 1: Replace category tests with process-order tests**

```js
test('leading error run branches from root and rejoins the first valid case', () => {
  const graph = buildProcessGraph([
    { id: 'e1', index: 1, status: 'error' },
    { id: 'e2', index: 2, status: 'error' },
    { id: 'ok', index: 3, status: 'normal' },
  ]);
  assert.deepEqual(graph.edges, [
    { from: 'root', to: 'ok', kind: 'main' },
    { from: 'root', to: 'e1', kind: 'error' },
    { from: 'e1', to: 'e2', kind: 'error' },
    { from: 'e2', to: 'ok', kind: 'return' },
  ]);
});

test('every case appears once and mainline order matches source index', () => {
  const graph = buildProcessGraph(archiveData.cases);
  assert.deepEqual(graph.nodes.map((node) => node.id).sort(), archiveData.cases.map((item) => item.id).sort());
  assert.deepEqual(graph.mainline.map((node) => node.index), [...graph.mainline.map((node) => node.index)].sort((a, b) => a - b));
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/archive-mindmap-model.test.mjs`

Expected: FAIL because the old model still emits four categories.

- [ ] **Step 3: Implement error-run extraction and rejoin edges**

```js
export function buildProcessGraph(records = []) {
  const ordered = [...records].sort((a, b) => a.index - b.index);
  const mainline = ordered.filter((record) => record.status !== 'error');
  const edges = [];
  let cursor = 0;
  let anchor = 'root';
  while (cursor < ordered.length) {
    const errors = [];
    while (ordered[cursor]?.status === 'error') errors.push(ordered[cursor++]);
    const next = ordered[cursor];
    if (next) edges.push({ from: anchor, to: next.id, kind: 'main' });
    if (errors.length) {
      edges.push({ from: anchor, to: errors[0].id, kind: 'error' });
      errors.slice(1).forEach((item, index) => edges.push({ from: errors[index].id, to: item.id, kind: 'error' }));
      if (next) edges.push({ from: errors.at(-1).id, to: next.id, kind: 'return' });
    }
    if (!next) break;
    anchor = next.id;
    cursor += 1;
  }
  return { nodes: ordered, mainline, edges };
}
```

- [ ] **Step 4: Run model tests**

Run: `node --test tests/archive-mindmap-model.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/archive-mindmap-model.js tests/archive-mindmap-model.test.mjs
git commit -m "feat: model prompt archive as chronological process"
```

### Task 5: Render the prompt process path without losing canvas controls

**Files:**
- Modify: `src/archive-mindmap.js`
- Modify: `style.css`
- Modify: `tests/archive-mindmap.test.mjs`
- Modify: `tests/mindmap-browser.smoke.mjs`

- [ ] **Step 1: Add failing shell and source assertions**

```js
test('mindmap shell describes a chronological production path and keeps all camera actions', () => {
  const html = buildMindmapShell(72);
  assert.match(html, /按白板顺序展开/);
  for (const action of ['overview', 'restore', 'collapse']) assert.match(html, new RegExp(`data-mindmap-action="${action}"`));
  assert.doesNotMatch(html, /视觉方向探索|人物与场景|错误案例与修正|首尾帧与动态/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/archive-mindmap.test.mjs`

Expected: FAIL because the category labels remain.

- [ ] **Step 3: Replace category mounting with process mounting**

Use `buildProcessGraph(cases)`. Place mainline nodes on increasing x positions and place each error run below its anchor:

```js
const mainBox = (index) => ({ x: 760 + index * 430, y: 1550, width: 286, height: 216 });
const errorBox = (anchorIndex, branchIndex) => ({ x: 760 + (anchorIndex + branchIndex * .78) * 430, y: 1880, width: 286, height: 216 });
```

Render `main`, `error`, and `return` edge classes from graph edges. Keep existing pointer drag, wheel zoom, `overview()`, `restoreReadingView()`, collapse, modal selection, ambient particles, and camera-follow cleanup.

- [ ] **Step 4: Add process-specific styling**

Keep the existing archive warm-gold card treatment. Error nodes use the existing red border/badge; return edges transition back to warm gold. Do not import review reader colors.

- [ ] **Step 5: Run map tests and smoke test**

Run: `node --test tests/archive-mindmap-model.test.mjs tests/archive-mindmap.test.mjs tests/mindmap-browser.smoke.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/archive-mindmap.js style.css tests/archive-mindmap.test.mjs tests/mindmap-browser.smoke.mjs
git commit -m "feat: render chronological prompt process canvas"
```

### Task 6: Model the review live maps without disturbing source media

**Files:**
- Create: `src/review-live-map-model.js`
- Create: `tests/review-live-map.test.mjs`

- [ ] **Step 1: Add model tests for the two confirmed source summary images**

```js
test('summary image refs resolve to independent map definitions', () => {
  assert.equal(resolveReviewMap('Pasted image 20260620133330.png').id, 'image-generation');
  assert.equal(resolveReviewMap('Pasted image 20260716153618.png').id, 'editing');
  assert.equal(resolveReviewMap('Pasted image 20260620160734.png'), null);
});

test('image-generation map preserves the summary hierarchy', () => {
  const map = REVIEW_LIVE_MAPS['image-generation'];
  assert.deepEqual(map.roots, ['style-master', 'specific-frame']);
  assert.deepEqual(map.nodes['specific-frame'].children, ['spatial-logic']);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/review-live-map.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Define stable map data**

```js
export const REVIEW_LIVE_MAPS = Object.freeze({
  'image-generation': {
    id: 'image-generation',
    title: '生图流程拆解',
    summaryRef: 'Pasted image 20260620133330.png',
    roots: ['style-master', 'specific-frame'],
    nodes: {
      'style-master': { title: '确定风格母图', children: ['visual-language'] },
      'visual-language': { title: '感受 · 模糊画面 · 自然语言交互生成', children: ['followup-generation', 'extract-style-prompt'] },
      'specific-frame': { title: '生成具体画面', children: ['spatial-logic'] },
      'spatial-logic': { title: '空间逻辑的具体问题', children: ['text-prompt', 'visual-reference', 'reset-camera'] },
    },
  },
  editing: {
    id: 'editing',
    title: '剪辑流程拆解',
    summaryRef: 'Pasted image 20260716153618.png',
    roots: ['general-process', 'specific-details'],
    nodes: {},
  },
});
```

Populate every leaf with exact review section identifiers and media refs from `review.json`; do not copy or reorder media.

- [ ] **Step 4: Run the model test**

Run: `node --test tests/review-live-map.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review-live-map-model.js tests/review-live-map.test.mjs
git commit -m "feat: model review summary maps"
```

### Task 7: Add the full-screen review live-map overlay

**Files:**
- Create: `src/review-live-map.js`
- Modify: `src/review-reader.js`
- Modify: `style.css`
- Modify: `tests/review-live-map.test.mjs`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Add failing interaction tests**

```js
test('live map opens from a summary image and restores focus and scroll on close', () => {
  const harness = createLiveMapHarness();
  const cleanup = mountReviewLiveMaps(harness.root, harness.options);
  harness.trigger.click();
  assert.equal(harness.dialog.hidden, false);
  harness.close.click();
  assert.equal(harness.dialog.hidden, true);
  assert.equal(harness.document.activeElement, harness.trigger);
  assert.equal(harness.scrollTop, harness.originalScrollTop);
  cleanup();
});

test('canvas supports pan, wheel zoom, overview, reset and progressive expansion', () => {
  const harness = createLiveMapHarness();
  harness.open();
  harness.drag({ dx: 120, dy: 40 });
  harness.wheel(-1);
  harness.clickNode('specific-frame');
  assert.match(harness.world.style.transform, /translate/);
  assert.equal(harness.node('spatial-logic').hidden, false);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/review-live-map.test.mjs`

Expected: FAIL because `mountReviewLiveMaps` does not exist.

- [ ] **Step 3: Render summary-image triggers in place**

In `blockMarkup`, when `resolveReviewMap(block.ref)` returns a definition, wrap only that image:

```js
return `<button class="review-map-cover" data-review-live-map="${map.id}" aria-label="进入${escapeHtml(map.title)}交互拆解">
  ${existingImageMarkup}
  <span><b>进入交互拆解</b><small>拖动 · 缩放 · 逐层展开</small></span>
</button>`;
```

- [ ] **Step 4: Implement the overlay controller**

`mountReviewLiveMaps` must create one reusable dialog, lock background scrolling while open, save the reader scrollTop and trigger, render only visible nodes, support pointer drag and wheel zoom, fit visible bounds for overview, restore the initial camera, open a leaf detail using the existing ordered block/media renderer, pause videos on close, and restore focus and scroll.

- [ ] **Step 5: Add scoped overlay styles**

Use the summary image as the cover. Use a dark full-screen shell coordinated with the review reader. Node colors may follow each source summary’s red/orange emphasis but must not copy archive warm-gold cards.

- [ ] **Step 6: Run review tests**

Run: `node --test tests/review-live-map.test.mjs tests/review-reader-ui.test.mjs tests/responsive-layout.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/review-live-map.js src/review-reader.js style.css tests/review-live-map.test.mjs tests/review-reader-ui.test.mjs tests/responsive-layout.test.mjs
git commit -m "feat: add interactive review summary maps"
```

### Task 8: Validate source coverage and identify the missing video summary

**Files:**
- Modify: `tests/review-data.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-27-interactive-maps-redesign.md`

- [ ] **Step 1: Add a source audit test**

```js
test('every enabled review live map points to one real summary image and valid source blocks', () => {
  for (const map of Object.values(REVIEW_LIVE_MAPS)) {
    assert.equal(findMediaByRef(reviewData, map.summaryRef).length, 1);
    for (const node of Object.values(map.nodes)) {
      for (const ref of node.mediaRefs ?? []) assert.equal(findMediaByRef(reviewData, ref).length >= 1, true);
    }
  }
});
```

- [ ] **Step 2: Verify current source facts**

Run a source report from `review.json`.

Expected: the confirmed summary images are `Pasted image 20260620133330.png` for 生图 and `Pasted image 20260716153618.png` for 剪辑. No third video-summary mind-map image is currently present as a standalone review block.

- [ ] **Step 3: Keep video disabled until a real summary image is identified**

Do not assign an unrelated video example screenshot as the video map cover. Document the missing source fact in the design spec and leave the ordinary image/video examples untouched.

- [ ] **Step 4: Run data tests**

Run: `node --test tests/review-data.test.mjs tests/review-live-map.test.mjs`

Expected: PASS with two enabled maps and no false video trigger.

- [ ] **Step 5: Commit**

```bash
git add tests/review-data.test.mjs docs/superpowers/specs/2026-07-27-interactive-maps-redesign.md
git commit -m "docs: record review summary map source coverage"
```

### Task 9: Full verification and visual review

**Files:**
- Modify only if verification finds a scoped defect.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Start the local preview**

Run: `npm run preview`

Expected: preview URL opens successfully and supports byte-range video requests.

- [ ] **Step 3: Verify the desktop review reader**

At 1440×900 and 1920×1080 confirm: 19–20px body text, wide content area, no persistent chapter sidebar, compact rail hover labels, rail navigation, physical forward/back turns, rapid-click safety, unchanged case grouping, and fully opaque media.

- [ ] **Step 4: Verify the prompt process canvas**

Confirm: no four-category fork, case order matches the whiteboard-derived sequence, each error run branches and rejoins, drag/zoom work, overview and restore work after manual movement, collapse returns to root, and complete case modals still open.

- [ ] **Step 5: Verify review live maps**

Confirm: cover images remain in their original article positions, overlays open and close, drag/zoom/overview/reset work, node expansion follows the source summaries, details show the correct ordered media and annotations, videos pause on close, and the reader returns to the original scroll position.

- [ ] **Step 6: Verify mobile regression**

At 390×844 confirm the existing chapter drawer remains usable, the compact desktop rail is hidden, summary-image covers remain readable, and live-map controls fit without horizontal page overflow.

- [ ] **Step 7: Commit verification-only fixes if files changed**

Inspect `git status --short`, stage only files changed to correct defects found in Steps 3–6, and commit them with:

```bash
git commit -m "fix: close interactive archive verification gaps"
```

If Steps 3–6 require no code changes, skip this commit.
