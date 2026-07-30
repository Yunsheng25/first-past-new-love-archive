# Immersive Review Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow review page with an immersive double-page reader that preserves authored case callouts, supports real page turns, themes, free-text highlights/notes, and in-place interactive process maps.

**Architecture:** Keep `data/review.json` as the canonical ordered content source. Add small pure modules for spread navigation and local annotations, then let `review-reader.js` compose them into the existing route. Reuse the existing review rail and live-map controller instead of rebuilding either interaction.

**Tech Stack:** Static HTML/CSS, ES modules, Node built-in test runner, browser Selection/Range APIs, localStorage.

---

## File Structure

- `src/review-spread.js`: flatten review pages and resolve two-page spreads.
- `src/review-annotations.js`: serialize local highlights, notes, theme, font size, and progress.
- `src/review-reader.js`: render spread chrome, authored callouts, settings, notebook, and detail layers.
- `src/review-reader-interactions.js`: bind wheel turns, selection tools, immersive mode, case detail, and image zoom.
- `src/review-live-map-model.js`: add the video-production interactive map.
- `src/review-live-map.js`: keep maps inside the authored summary frame and restore reading position on exit.
- `style.css`: final double-page, page-turn, callout-detail, notebook, and theme presentation.
- `scripts/build-review-data.mjs`: reject unmatched Markdown bold markers before publishing.
- `tests/review-spread.test.mjs`: spread navigation tests.
- `tests/review-annotations.test.mjs`: persistence and range-anchor tests.
- `tests/review-reader-ui.test.mjs`: markup, authored-order, and interaction contract tests.
- `tests/review-live-map.test.mjs`: all three summary maps.
- `tests/review-data.test.mjs`: source Markdown validation and media-order checks.

### Task 1: Double-page spread model

**Files:**
- Create: `src/review-spread.js`
- Create: `tests/review-spread.test.mjs`

- [ ] **Step 1: Write the failing spread tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenReviewPages, resolveReviewSpread } from '../src/review-spread.js';

test('a spread contains the current page and the immediately following source page', () => {
  const data = { chapters: [
    { slug: 'a', title: 'A', pages: [[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]] },
    { slug: 'b', title: 'B', pages: [[{ type: 'text', text: '3' }]] },
  ] };
  assert.deepEqual(flattenReviewPages(data).map((item) => item.href), [
    '#review/a/1', '#review/a/2', '#review/b/1',
  ]);
  const spread = resolveReviewSpread(data, 'a', 1);
  assert.equal(spread.left.href, '#review/a/1');
  assert.equal(spread.right.href, '#review/a/2');
  assert.equal(spread.nextHref, '#review/b/1');
  assert.equal(spread.previousHref, null);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-spread.test.mjs`  
Expected: FAIL because `src/review-spread.js` does not exist.

- [ ] **Step 3: Implement the pure spread resolver**

```js
export function flattenReviewPages(data) {
  return (data?.chapters ?? []).flatMap((chapter) =>
    (chapter.pages ?? []).map((blocks, pageIndex) => ({
      chapter,
      blocks,
      pageIndex,
      href: `#review/${chapter.slug}/${pageIndex + 1}`,
    })));
}

export function resolveReviewSpread(data, chapterSlug, pageNumber) {
  const pages = flattenReviewPages(data);
  const requested = pages.findIndex((page) =>
    page.chapter.slug === chapterSlug && page.pageIndex === Math.max(0, Number(pageNumber) - 1));
  if (requested < 0) return null;
  const leftIndex = requested - (requested % 2);
  return {
    index: leftIndex / 2,
    left: pages[leftIndex],
    right: pages[leftIndex + 1] ?? null,
    previousHref: pages[leftIndex - 2]?.href ?? null,
    nextHref: pages[leftIndex + 2]?.href ?? null,
  };
}
```

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/review-spread.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review-spread.js tests/review-spread.test.mjs
git commit -m "feat: model double-page review spreads"
```

### Task 2: Local highlight and note persistence

**Files:**
- Create: `src/review-annotations.js`
- Create: `tests/review-annotations.test.mjs`

- [ ] **Step 1: Write failing persistence tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_READER_STATE_KEY,
  readReaderState,
  writeReaderState,
  upsertAnnotation,
} from '../src/review-annotations.js';

const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('reader state persists theme, font and exact text anchors', () => {
  const local = storage();
  const state = upsertAnnotation(readReaderState(local), {
    id: 'origin-1-12-20',
    chapter: 'origin',
    page: 1,
    quote: '作品真正抵达人心',
    prefix: '迷恋',
    suffix: '的瞬间',
    kind: 'note',
    note: '核心创作动机',
  });
  state.theme = 'dark';
  state.fontSize = 20;
  writeReaderState(local, state);
  assert.equal(JSON.parse(local.getItem(REVIEW_READER_STATE_KEY)).annotations.length, 1);
  assert.equal(readReaderState(local).theme, 'dark');
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-annotations.test.mjs`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalized local state**

```js
export const REVIEW_READER_STATE_KEY = 'first-love-review-reader-v1';
const defaults = () => ({ theme: 'light', fontSize: 18, progress: null, annotations: [] });

export function readReaderState(storage = globalThis.localStorage) {
  try {
    return { ...defaults(), ...JSON.parse(storage?.getItem(REVIEW_READER_STATE_KEY) || '{}') };
  } catch {
    return defaults();
  }
}

export function writeReaderState(storage, state) {
  storage?.setItem(REVIEW_READER_STATE_KEY, JSON.stringify(state));
}

export function upsertAnnotation(state, annotation) {
  return {
    ...state,
    annotations: [...state.annotations.filter((item) => item.id !== annotation.id), annotation],
  };
}
```

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/review-annotations.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review-annotations.js tests/review-annotations.test.mjs
git commit -m "feat: persist review highlights and notes"
```

### Task 3: Render the immersive spread and preserve authored block order

**Files:**
- Modify: `src/review-reader.js`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Add failing markup assertions**

```js
test('review route renders a two-page spread with settings and notebook controls', () => {
  const target = normalizeReviewTarget(reviewData, 'production', 1);
  const html = buildReviewPage(reviewData, target);
  assert.match(html, /data-review-spread/);
  assert.match(html, /data-review-left-page/);
  assert.match(html, /data-review-right-page/);
  assert.match(html, /data-review-immersive/);
  assert.match(html, /data-review-settings/);
  assert.match(html, /data-review-notebook/);
});

test('authored callout keeps title, children and detail action inside one frame', () => {
  const target = normalizeReviewTarget(reviewData, 'production', 3);
  const html = buildReviewPage(reviewData, target);
  assert.match(html, /review-callout-label">批注/);
  assert.match(html, /data-review-callout-detail/);
  assert.deepEqual(renderedSignature(html), expectedSignature(target.chapter, target.pageIndex));
});
```

- [ ] **Step 2: Run the focused tests**

Run: `node --test tests/review-reader-ui.test.mjs`  
Expected: FAIL on the new spread and detail selectors.

- [ ] **Step 3: Compose two page articles without changing block markup**

```js
const spread = resolveReviewSpread(data, target.chapter.slug, target.pageIndex + 1);
return `<section class="review-reader-view app-view" data-review-reader>
  ${reviewReaderToolbar(spread)}
  <main class="review-spread" data-review-spread>
    ${reviewPaper(spread.left, 'left')}
    ${spread.right ? reviewPaper(spread.right, 'right') : '<article class="review-paper is-blank"></article>'}
  </main>
  ${reviewSelectionToolbar()}
  ${reviewSettingsPanel()}
  ${reviewNotebookPanel()}
  ${reviewCaseDetailLayer()}
</section>`;
```

Update callout markup to include the detail action after its unchanged children:

```js
<button type="button" data-review-callout-detail data-callout-id="${occurrence}">
  查看案例详情 <span aria-hidden="true">↗</span>
</button>
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/review-reader-ui.test.mjs`  
Expected: PASS, including the existing 51-media ordering test.

- [ ] **Step 5: Commit**

```bash
git add src/review-reader.js tests/review-reader-ui.test.mjs
git commit -m "feat: render immersive double-page review reader"
```

### Task 4: Bind wheel turns, immersive mode, themes, and exact selection

**Files:**
- Create: `src/review-reader-interactions.js`
- Modify: `src/review-reader.js`
- Create: `tests/review-reader-interactions.test.mjs`

- [ ] **Step 1: Write failing controller tests**

```js
test('wheel threshold turns once and ignores momentum during cooldown', () => {
  const moves = [];
  let now = 1000;
  const controller = createReviewWheelController({
    navigate: (direction) => moves.push(direction),
    clock: () => now,
    threshold: 58,
    cooldown: 900,
  });
  controller.push(20);
  controller.push(40);
  controller.push(120);
  assert.deepEqual(moves, [1]);
  now = 2000;
  controller.push(-70);
  assert.deepEqual(moves, [1, -1]);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-reader-interactions.test.mjs`  
Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement interaction boundaries**

```js
export function createReviewWheelController({
  navigate, clock = () => performance.now(), threshold = 58, cooldown = 900,
}) {
  let total = 0;
  let lastTurn = -Infinity;
  return {
    push(delta) {
      const now = clock();
      if (now - lastTurn < cooldown) return false;
      total += delta;
      if (Math.abs(total) < threshold) return false;
      navigate(total > 0 ? 1 : -1);
      total = 0;
      lastTurn = now;
      return true;
    },
    reset() { total = 0; },
  };
}
```

Bind:

- wheel to the spread controller;
- Fullscreen API plus a visible exit button;
- theme/font settings to `review-annotations.js`;
- Selection/Range mouseup to an anchored quote;
- exact-range `<mark>` wrapping for highlights and notes;
- notebook filters and return-to-source links.

- [ ] **Step 4: Run interaction and reader tests**

Run: `node --test tests/review-reader-interactions.test.mjs tests/review-reader-ui.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review-reader-interactions.js src/review-reader.js tests/review-reader-interactions.test.mjs tests/review-reader-ui.test.mjs
git commit -m "feat: add immersive reader interactions"
```

### Task 5: Case-detail and original-image drilldown

**Files:**
- Modify: `src/review-reader-interactions.js`
- Modify: `src/review-reader.js`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Add failing detail-layer tests**

```js
test('case detail preserves media sequence and supports image drilldown', () => {
  const html = buildReviewPage(reviewData, normalizeReviewTarget(reviewData, 'production', 3));
  assert.match(html, /data-review-case-detail/);
  assert.match(html, /data-review-case-detail-close/);
  assert.match(html, /data-review-case-image-zoom/);
  assert.match(html, /data-review-lightbox/);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-reader-ui.test.mjs`  
Expected: FAIL on detail layer selectors.

- [ ] **Step 3: Implement two-level detail behavior**

```js
function openCalloutDetail(callout) {
  const detail = root.querySelector('[data-review-case-detail]');
  detail.querySelector('[data-review-case-detail-content]').replaceChildren(callout.cloneNode(true));
  detail.hidden = false;
  detail.querySelector('[data-review-case-detail-close]').focus();
}
```

Use the existing image lightbox for images inside both the compact callout and the enlarged detail. Closing the image returns focus to the detail; closing the detail returns focus to its trigger.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/review-reader-ui.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review-reader.js src/review-reader-interactions.js tests/review-reader-ui.test.mjs
git commit -m "feat: add authored case detail drilldown"
```

### Task 6: Complete all three in-place interactive maps

**Files:**
- Modify: `src/review-live-map-model.js`
- Modify: `src/review-live-map.js`
- Modify: `tests/review-live-map.test.mjs`

- [ ] **Step 1: Change the failing map contract**

```js
test('all three authored summary images resolve to independent live maps', () => {
  assert.equal(resolveReviewMap('Pasted image 20260620133330.png').id, 'image-generation');
  assert.equal(resolveReviewMap('Pasted image 20260620160734.png').id, 'video-production');
  assert.equal(resolveReviewMap('Pasted image 20260716153618.png').id, 'editing');
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-live-map.test.mjs`  
Expected: FAIL because the video summary currently resolves to `null`.

- [ ] **Step 3: Add the authored video process tree**

```js
'video-production': {
  id: 'video-production',
  title: '视频流程拆解',
  sourceRef: 'Pasted image 20260620160734.png',
  roots: ['video-process'],
  nodes: {
    'video-process': {
      id: 'video-process',
      title: '视频过程拆解',
      children: ['motion-design', 'video-prompts', 'frame-bridges'],
    },
    'motion-design': { id: 'motion-design', title: '选图与设计运动', children: ['need-full-motion', 'rewrite-as-result'] },
    'video-prompts': { id: 'video-prompts', title: '视频提示词、生成与筛选', children: ['simple-motion', 'complex-motion'] },
    'frame-bridges': { id: 'frame-bridges', title: '首尾帧衔接和过渡帧补充', children: ['end-frame-rewrite', 'transition-grid'] },
  },
}
```

- [ ] **Step 4: Verify in-place behavior**

Run: `node --test tests/review-live-map.test.mjs`  
Expected: PASS, and the map source still uses the existing drag guard and zoom controller.

- [ ] **Step 5: Commit**

```bash
git add src/review-live-map-model.js src/review-live-map.js tests/review-live-map.test.mjs
git commit -m "feat: add interactive video process map"
```

### Task 7: Repair and validate Markdown emphasis

**Files:**
- Modify: `D:\黑曜石\产品资料\《初恋旧爱新欢》视频复盘\《初恋旧爱新欢》复盘手记.md`
- Modify: `scripts/build-review-data.mjs`
- Modify: `tests/review-data.test.mjs`
- Regenerate: `data/review.json`

- [ ] **Step 1: Add a failing unmatched-emphasis test**

```js
test('review source has no unmatched bold delimiter', () => {
  const source = fs.readFileSync(reviewPath, 'utf8');
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const delimiters = line.match(/\*\*/g)?.length ?? 0;
    assert.equal(delimiters % 2, 0, `line ${index + 1} has unmatched **`);
  }
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/review-data.test.mjs`  
Expected: FAIL on the known malformed lines, including the lines containing “提示词不要…”, “合拍”, “镜头之间的关系…”, and “一条线索的成立…”.

- [ ] **Step 3: Correct the source and guard the builder**

Close each intended bold span in the Obsidian source without changing prose or media positions. Add:

```js
export function assertBalancedBold(markdown) {
  markdown.split(/\r?\n/).forEach((line, index) => {
    if ((line.match(/\*\*/g)?.length ?? 0) % 2 !== 0) {
      throw new Error(`Unmatched bold marker on source line ${index + 1}`);
    }
  });
}
```

Call the validator before `parseReview`.

- [ ] **Step 4: Rebuild and verify content invariants**

Run: `npm run build:data && node --test tests/review-data.test.mjs tests/review-reader-ui.test.mjs`  
Expected: PASS; 51 media occurrences remain in the same order and rendered output contains no literal unmatched `**`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-review-data.mjs tests/review-data.test.mjs data/review.json
git commit -m "fix: repair review emphasis rendering" -m "Source Markdown was repaired in the Obsidian vault before rebuilding data/review.json."
```

The source note is outside the repository, so only the repository files are committed; record the external source repair in the commit body.

### Task 8: Final reader styling and full verification

**Files:**
- Modify: `style.css`
- Modify: `tests/responsive-layout.test.mjs`
- Modify: `tests/browser-cdp.test.mjs`

- [ ] **Step 1: Add failing CSS contract tests**

```js
test('desktop reader exposes spread, immersive, callout and notebook layouts', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.review-spread\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
  assert.match(css, /body\.review-immersive[\s\S]*\.review-reader-toolbar/);
  assert.match(css, /\.review-callout-detail/);
  assert.match(css, /\.review-notebook/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
});
```

- [ ] **Step 2: Run the CSS tests**

Run: `node --test tests/responsive-layout.test.mjs`  
Expected: FAIL until the new selectors exist.

- [ ] **Step 3: Port the approved visual prototype**

Implement:

```css
.review-spread {
  height: 100%;
  max-width: 1540px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  perspective: 2200px;
}
body.review-immersive .review-reader-toolbar { opacity: 0; pointer-events: none; }
.review-page-turn-sheet { transform-style: preserve-3d; transform-origin: left center; }
.review-callout-media-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
```

Preserve the existing `.review-rail` interaction selectors and their 150px hit area.

- [ ] **Step 4: Run complete verification**

Run: `npm test`  
Expected: all tests PASS.

Run: `npm run preview` and manually verify:

1. wheel and buttons turn one spread at a time;
2. immersive mode enters and exits;
3. rail animation and tooltips match the existing site;
4. free selection creates exact highlights and notes;
5. authored case detail and image zoom restore focus correctly;
6. light/dark settings persist;
7. all three summary maps open in place.

- [ ] **Step 5: Commit**

```bash
git add style.css tests/responsive-layout.test.mjs tests/browser-cdp.test.mjs
git commit -m "style: finish immersive review reading experience"
```
