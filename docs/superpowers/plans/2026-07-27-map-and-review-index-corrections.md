# Map and Review Index Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the two mind-map hierarchies and turn the review rail into a wide, fluid, informative navigation target without accidental browser selection or cursor-layer interference.

**Architecture:** Keep authored review and archive data unchanged. Add one real root node to the review live-map model, centralize archive child positioning in a pure layout helper, and give the review rail a focused interaction controller that computes the nearest tick inside a wide transparent hit zone. CSS owns selection prevention and layering; JavaScript only owns state derived from pointer position.

**Tech Stack:** Native ES modules, DOM/SVG, CSS transitions, Node.js test runner.

---

### Task 1: Restore the review live-map trunk

**Files:**
- Modify: `src/review-live-map-model.js`
- Modify: `tests/review-live-map.test.mjs`

- [ ] **Step 1: Write the failing hierarchy test**

Add an assertion that the image-generation map exposes one root called `image-process`, and that expanding it reveals the existing two branches:

```js
const map = REVIEW_LIVE_MAPS['image-generation'];
assert.deepEqual(map.roots, ['image-process']);
assert.equal(map.nodes['image-process'].title, '生图过程拆解');
assert.deepEqual(map.nodes['image-process'].children, ['style-master', 'specific-frame']);
assert.deepEqual(visibleReviewMapNodes(map, new Set(['image-process'])), [
  'image-process',
  'style-master',
  'specific-frame',
]);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --test tests/review-live-map.test.mjs
```

Expected: FAIL because the current map directly exposes two roots.

- [ ] **Step 3: Add the single real trunk node**

Change the image-generation map to:

```js
roots: ['image-process'],
nodes: Object.freeze({
  'image-process': {
    title: '生图过程拆解',
    children: ['style-master', 'specific-frame'],
  },
  // keep every existing node below unchanged
})
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
node --test tests/review-live-map.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/review-live-map-model.js tests/review-live-map.test.mjs
git commit -m "fix: restore image process map trunk"
```

### Task 2: Make the archive’s initial error split symmetric

**Files:**
- Modify: `src/archive-mindmap.js`
- Modify: `tests/archive-mindmap.test.mjs`

- [ ] **Step 1: Write the failing layout test**

Export a pure helper named `symmetricChildBoxes(parentBox, children)` and test that two children have equal horizontal positions and centers equally above and below the parent:

```js
const boxes = symmetricChildBoxes(
  { x: 350, y: 1580, width: 220, height: 220 },
  [{ id: 'main' }, { id: 'error' }],
);
const parentCenter = 1580 + 110;
assert.equal(boxes[0].x, boxes[1].x);
assert.equal(
  parentCenter - (boxes[0].y + boxes[0].height / 2),
  (boxes[1].y + boxes[1].height / 2) - parentCenter,
);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --test tests/archive-mindmap.test.mjs
```

Expected: FAIL because `symmetricChildBoxes` does not yet exist and `start()` places both children above the root center.

- [ ] **Step 3: Implement and reuse symmetric positioning**

Add:

```js
export function symmetricChildBoxes(parentBox, children = []) {
  const step = 300;
  const center = parentBox.y + parentBox.height / 2;
  return children.map((child, index) => {
    const offset = (index - (children.length - 1) / 2) * step;
    return {
      id: child.id,
      x: parentBox.x + parentBox.width + 190,
      y: center + offset - 93,
      width: 286,
      height: 186,
    };
  });
}
```

Use the helper both in `start()` and for multi-child expansion. Preserve main/error ordering, edge kinds, case ordering, details, overview, restore, pan and zoom.

- [ ] **Step 4: Run the archive map tests**

Run:

```powershell
node --test tests/archive-mindmap.test.mjs tests/archive-mindmap-model.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/archive-mindmap.js tests/archive-mindmap.test.mjs
git commit -m "fix: balance archive process branches"
```

### Task 3: Build a wide, fluid review rail interaction

**Files:**
- Create: `src/review-rail-interaction.js`
- Create: `tests/review-rail-interaction.test.mjs`
- Modify: `src/review-rail.js`
- Modify: `src/review-reader.js`
- Modify: `tests/review-rail.test.mjs`

- [ ] **Step 1: Write failing rail-data and interaction tests**

Assert every rail item contains a one-based global sequence plus specific context:

```js
assert.deepEqual(items.map((item) => item.sequence), [1, 2, 3, 4]);
assert.equal(items[1].title, '案例');
assert.equal(items[1].meta, '第 02 项 · 第 2 页');
```

Test a pure nearest-tick helper:

```js
assert.equal(nearestTickIndex([10, 40, 80], 56), 1);
assert.equal(nearestTickIndex([10, 40, 80], 72), 2);
assert.equal(nearestTickIndex([], 20), -1);
```

Test that the mounted controller marks the nearest tick active, its neighbors near, updates `--review-rail-y`, and clears all temporary state on pointer leave and cleanup.

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```powershell
node --test tests/review-rail.test.mjs tests/review-rail-interaction.test.mjs
```

Expected: FAIL because sequence/meta and the interaction controller do not exist.

- [ ] **Step 3: Extend rail item markup**

Make `buildReviewRail()` return `sequence`, `title`, and `meta`. Render:

```html
<a class="review-rail-tick ..." data-review-rail-tick>
  <span class="review-rail-tip">
    <b>空间逻辑与构图问题</b>
    <small>第 18 项 · 第 9 页</small>
  </span>
</a>
```

Keep the existing href, direction, current item, chapter/case/page types and source ordering.

- [ ] **Step 4: Implement the focused controller**

Create:

```js
export function nearestTickIndex(centers = [], pointerY = 0) {
  let best = -1;
  let distance = Infinity;
  centers.forEach((center, index) => {
    const next = Math.abs(pointerY - center);
    if (next < distance) {
      best = index;
      distance = next;
    }
  });
  return best;
}
```

`mountReviewRail(root)` must listen on `[data-review-rail]`, compute tick centers from `getBoundingClientRect()`, set `.is-active` and `.is-near`, and clear state on `pointerleave`. It must not prevent the anchors’ normal navigation.

- [ ] **Step 5: Bind and clean up the controller**

In `bindReviewInteractions()`:

```js
const cleanupRail = mountReviewRail(root);
// ...
cleanupRail();
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node --test tests/review-rail.test.mjs tests/review-rail-interaction.test.mjs tests/review-reader-ui.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/review-rail.js src/review-rail-interaction.js src/review-reader.js tests/review-rail.test.mjs tests/review-rail-interaction.test.mjs
git commit -m "feat: make review rail fluid and informative"
```

### Task 4: Prevent accidental selection and fix cursor/control layering

**Files:**
- Modify: `src/archive-mindmap.js`
- Modify: `src/review-live-map.js`
- Modify: `style.css`
- Modify: `tests/archive-mindmap.test.mjs`
- Modify: `tests/review-live-map.test.mjs`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Write failing input and CSS tests**

Add source assertions that both canvas pointer-down handlers reject non-primary input:

```js
assert.match(source, /event\.button !== 0/);
```

Add CSS assertions for:

```css
.archive-mindmap-viewport,
.archive-mindmap-world,
.mindmap-node,
.review-live-map-viewport,
.review-live-map-world,
.review-live-node,
.review-rail {
  user-select: none;
  -webkit-user-select: none;
}
```

Assert `.review-return-after`, `.archive-return-after` and other fixed controls use a z-index greater than `.after-cursor`, while the cursor retains `pointer-events: none`.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```powershell
node --test tests/archive-mindmap.test.mjs tests/review-live-map.test.mjs tests/review-reader-ui.test.mjs
```

Expected: FAIL on missing primary-button guards, selection rules or control layering.

- [ ] **Step 3: Restrict dragging to the primary button**

At the start of both pointer-down handlers:

```js
if (event.button !== undefined && event.button !== 0) return;
```

Keep clicks on buttons and detail panels excluded from canvas dragging.

- [ ] **Step 4: Add scoped selection and layering rules**

Disable selection and native image dragging only inside interactive map and rail surfaces. Do not disable selection in review paragraphs, callout text or detail copy. Set fixed navigation controls above the cursor, for example:

```css
.review-return-after,
.archive-return-after,
.review-drawer-toggle,
.review-page-nav {
  z-index: 30;
}

.after-cursor {
  z-index: 20;
  pointer-events: none;
}
```

Add the approved 150px rail hit zone, cursor-following highlight, active/near tick transitions and tooltip behavior. Reduced-motion mode keeps nearest-item feedback but removes follow animations.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/archive-mindmap.test.mjs tests/review-live-map.test.mjs tests/review-rail-interaction.test.mjs tests/review-reader-ui.test.mjs tests/responsive-layout.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/archive-mindmap.js src/review-live-map.js style.css tests/archive-mindmap.test.mjs tests/review-live-map.test.mjs tests/review-reader-ui.test.mjs
git commit -m "fix: prevent map selection and cursor overlap"
```

### Task 5: Full verification and local preview

**Files:**
- Verify only

- [ ] **Step 1: Check formatting and worktree scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated `.auth-home/`, screenshots and `publish-site-20260722/` remain untracked and unstaged.

- [ ] **Step 2: Run the complete suite**

Run:

```powershell
npm.cmd test
```

Expected: zero failures.

- [ ] **Step 3: Start or confirm the preview**

Run:

```powershell
npm.cmd run preview
```

Expected: `Preview running at http://localhost:8080/`.

- [ ] **Step 4: Check the relevant routes**

Open:

```text
http://localhost:8080/#review/production/9
http://localhost:8080/#archive
```

Verify the image map starts at “生图过程拆解”; the archive’s first two branches sit above and below the root; the review rail reacts throughout its wide hit zone; right-click does not drag or select; fixed return controls remain above the cursor.
