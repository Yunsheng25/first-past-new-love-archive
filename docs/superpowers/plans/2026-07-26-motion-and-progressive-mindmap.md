# Motion and Progressive Mindmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved cinematic text motion, per-character hover response, progressively expanding prompt mindmap, reliable canvas controls, and interactive particle background to the production website.

**Architecture:** Keep archive data unchanged and introduce a focused `archive-mindmap.js` renderer that consumes existing records and connections. Keep camera math in `mindmap-camera.js`, pointer ambience in `mindmap-ambient.js`, and text splitting/motion in `text-motion.js`; `archive-ui.js` only switches between mindmap and tunnel modes.

**Tech Stack:** Native ES modules, DOM/SVG, CSS animations and custom properties, Node built-in test runner, Playwright smoke checks with installed Chrome.

---

### Task 1: Character-level text motion

**Files:**
- Create: `src/text-motion.js`
- Modify: `script.js`
- Modify: `style.css`
- Test: `tests/text-motion.test.mjs`

- [ ] **Step 1: Write the failing unit test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { splitTextCharacters } from "../src/text-motion.js";

test("splitTextCharacters preserves spaces and punctuation", () => {
  assert.deepEqual(splitTextCharacters("初恋 · 旧爱"), ["初", "恋", " ", "·", " ", "旧", "爱"]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/text-motion.test.mjs`

Expected: FAIL because `src/text-motion.js` does not exist.

- [ ] **Step 3: Implement the text splitter and mount function**

```js
export function splitTextCharacters(text) {
  return [...text];
}

export function mountCharacterMotion(root, selector = "[data-character-motion]") {
  const elements = [...root.querySelectorAll(selector)];
  for (const element of elements) {
    if (element.dataset.characterMotionMounted === "true") continue;
    const fragment = document.createDocumentFragment();
    for (const character of splitTextCharacters(element.textContent ?? "")) {
      const span = document.createElement("span");
      span.className = "motion-character";
      span.textContent = character;
      fragment.append(span);
    }
    element.replaceChildren(fragment);
    element.dataset.characterMotionMounted = "true";
  }
}
```

Import `mountCharacterMotion` in `script.js` and call it after every view render. Add `data-character-motion` to the intro title, navigation labels, intro statements, watch button, and after-film choice labels in `src/views.js`.

- [ ] **Step 4: Add cinematic entry and per-character CSS**

```css
[data-cinematic-entry] {
  animation: cinematic-entry 1.05s cubic-bezier(.2,.75,.2,1) both;
  animation-delay: var(--entry-delay, 0s);
}

.motion-character {
  display: inline-block;
  transition: transform .42s cubic-bezier(.16,1,.3,1),
              color .32s,
              text-shadow .4s;
}

.motion-character:hover {
  transform: translateY(-.12em) scale(1.1);
  color: #fffaf1;
  text-shadow: 0 .12em .4em rgba(225,186,136,.55);
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

Commit:

```bash
git add src/text-motion.js src/views.js script.js style.css tests/text-motion.test.mjs
git commit -m "feat: add cinematic character text motion"
```

### Task 2: Mindmap graph model

**Files:**
- Create: `src/archive-mindmap-model.js`
- Test: `tests/archive-mindmap-model.test.mjs`

- [ ] **Step 1: Write failing model tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildMindmapGraph, getExpandableChildren } from "../src/archive-mindmap-model.js";

test("keeps real outgoing branches and falls back to sequential order", () => {
  const records = [
    { id: "a", index: 1, connections: [{ direction: "出线", toNode: "b" }, { direction: "出线", toNode: "c" }] },
    { id: "b", index: 2, connections: [] },
    { id: "c", index: 3, connections: [] },
  ];
  const graph = buildMindmapGraph(records);
  assert.deepEqual(getExpandableChildren(graph, "a").map((item) => item.id), ["b", "c"]);
  assert.deepEqual(getExpandableChildren(graph, "b").map((item) => item.id), ["c"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/archive-mindmap-model.test.mjs`

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement deterministic graph helpers**

```js
export function buildMindmapGraph(records) {
  const ordered = [...records].sort((a, b) => a.index - b.index);
  return {
    ordered,
    byId: new Map(ordered.map((record) => [record.id, record])),
  };
}

export function getExpandableChildren(graph, id) {
  const record = graph.byId.get(id);
  const linked = (record?.connections ?? [])
    .filter((connection) => connection.direction === "出线")
    .map((connection) => graph.byId.get(connection.toNode))
    .filter(Boolean);
  if (linked.length) return [...new Map(linked.map((item) => [item.id, item])).values()];
  const sequential = graph.ordered[record?.index];
  return sequential ? [sequential] : [];
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

Commit:

```bash
git add src/archive-mindmap-model.js tests/archive-mindmap-model.test.mjs
git commit -m "feat: add archive mindmap graph model"
```

### Task 3: Camera state and reliable overview controls

**Files:**
- Create: `src/mindmap-camera.js`
- Test: `tests/mindmap-camera.test.mjs`

- [ ] **Step 1: Write failing camera tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { fitBounds, restoreReadingView } from "../src/mindmap-camera.js";

test("fitBounds centers every visible box inside the viewport", () => {
  const result = fitBounds(
    [{ x: 350, y: 1580, width: 220, height: 220 }, { x: 2470, y: 1485, width: 230, height: 145 }],
    { width: 1440, height: 806 },
    80,
  );
  assert.ok(result.scale > 0);
  assert.ok(Number.isFinite(result.x));
  assert.ok(Number.isFinite(result.y));
});

test("restoreReadingView returns standard scale around the latest node", () => {
  assert.deepEqual(
    restoreReadingView({ x: 760, y: 1595, width: 286, height: 186 }, { width: 1440, height: 806 }),
    { scale: 0.72, x: 864 - 903 * 0.72, y: 403 - 1688 * 0.72 },
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/mindmap-camera.test.mjs`

Expected: FAIL because the camera module does not exist.

- [ ] **Step 3: Implement pure camera math**

```js
export function fitBounds(boxes, viewport, padding = 80) {
  const minX = Math.min(...boxes.map((box) => box.x));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const scale = Math.min(
    0.9,
    (viewport.width - padding) / (maxX - minX),
    (viewport.height - padding) / (maxY - minY),
  );
  return {
    scale,
    x: viewport.width / 2 - ((minX + maxX) / 2) * scale,
    y: viewport.height / 2 - ((minY + maxY) / 2) * scale,
  };
}

export function restoreReadingView(box, viewport) {
  const scale = 0.72;
  return {
    scale,
    x: viewport.width * 0.6 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
  };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

Commit:

```bash
git add src/mindmap-camera.js tests/mindmap-camera.test.mjs
git commit -m "feat: add mindmap camera controls"
```

### Task 4: Progressive mindmap renderer

**Files:**
- Create: `src/archive-mindmap.js`
- Modify: `src/archive-ui.js`
- Modify: `style.css`
- Test: `tests/archive-mindmap.test.mjs`

- [ ] **Step 1: Write failing renderer markup test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildMindmapShell } from "../src/archive-mindmap.js";

test("mindmap shell exposes every required control", () => {
  const html = buildMindmapShell();
  for (const action of ["overview", "restore", "collapse"]) {
    assert.match(html, new RegExp(`data-mindmap-action="${action}"`));
  }
  assert.match(html, /data-mindmap-root/);
  assert.match(html, /隧道漫游/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/archive-mindmap.test.mjs`

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Implement shell and progressive mounting**

Export:

```js
export function buildMindmapShell() {
  return `
    <section class="archive-mindmap" data-archive-mindmap>
      <header class="archive-mindmap__toolbar">
        <button data-archive-view="tunnel">隧道漫游</button>
        <button data-mindmap-action="overview">当前总览</button>
        <button data-mindmap-action="restore">恢复原样</button>
        <button data-mindmap-action="collapse">全部收起</button>
      </header>
      <div class="archive-mindmap__viewport" data-mindmap-viewport>
        <div class="archive-mindmap__ambient" data-mindmap-ambient></div>
        <div class="archive-mindmap__world" data-mindmap-world>
          <svg data-mindmap-edges></svg>
          <button class="mindmap-root" data-mindmap-root>制作从这里开始</button>
          <div data-mindmap-nodes></div>
          <div data-mindmap-ends></div>
        </div>
      </div>
    </section>`;
}
```

`mountArchiveMindmap({ root, records, onSwitchToTunnel })` must:

- start with no content nodes;
- expand actual outgoing children on card click;
- position children at `parent.x + 430` and `parent.y + branchOffset`;
- keep a single-child branch at the parent Y coordinate;
- open details only from the card's “查看内容” button;
- create a clickable end node for terminal branches;
- set the world width to at least `42000px`;
- exclude `.mindmap-node`, `.mindmap-root`, `.mindmap-end`, and toolbar buttons from drag start;
- use `fitBounds` for overview and `restoreReadingView` for restore.

Replace `renderList()` in `src/archive-ui.js` with `renderMindmap()`. Change tunnel's “列表模式” label and action to “思维导图”. Keep tunnel rendering and cleanup unchanged.

- [ ] **Step 4: Add production styles**

Port the approved prototype values:

- dark translucent cards;
- `286px` card width;
- warm gray-gold SVG edges;
- vertical branch spacing of `260px`;
- node grow-in animation;
- dark red error state;
- circular root and end nodes;
- fixed toolbar and status counter.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

Commit:

```bash
git add src/archive-mindmap.js src/archive-ui.js style.css tests/archive-mindmap.test.mjs
git commit -m "feat: replace archive list with progressive mindmap"
```

### Task 5: Interactive particle ambience

**Files:**
- Create: `src/mindmap-ambient.js`
- Modify: `src/archive-mindmap.js`
- Modify: `style.css`
- Test: `tests/mindmap-ambient.test.mjs`

- [ ] **Step 1: Write failing particle tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createParticleSeeds, getParticleResponse } from "../src/mindmap-ambient.js";

test("creates the approved particle density deterministically", () => {
  assert.equal(createParticleSeeds(72).length, 72);
  assert.deepEqual(createParticleSeeds(2), createParticleSeeds(2));
});

test("nearby particles are pushed and brightened", () => {
  const response = getParticleResponse({ x: 100, y: 100 }, { x: 110, y: 100 }, 190);
  assert.ok(Math.abs(response.pushX) > 0);
  assert.ok(response.scale > 1);
  assert.ok(response.opacity > 0.28);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/mindmap-ambient.test.mjs`

Expected: FAIL because the ambience module does not exist.

- [ ] **Step 3: Implement deterministic particles and pointer response**

```js
export function createParticleSeeds(count = 72) {
  return Array.from({ length: count }, (_, index) => ({
    left: (index * 37 + index * index * 3) % 97 + 1,
    top: (index * 61 + index * index * 5) % 91 + 4,
    duration: 3.6 + (index % 9) * 0.48,
  }));
}

export function getParticleResponse(particle, pointer, reach = 190) {
  const vx = particle.x - pointer.x;
  const vy = particle.y - pointer.y;
  const distance = Math.hypot(vx, vy);
  if (distance >= reach) return { pushX: 0, pushY: 0, scale: 1, opacity: 0.25 };
  const power = 1 - distance / reach;
  const length = distance || 1;
  return {
    pushX: (vx / length) * power * 34,
    pushY: (vy / length) * power * 34,
    scale: 1 + power * 1.15,
    opacity: 0.28 + power * 0.62,
  };
}
```

Mount 72 particles inside `[data-mindmap-ambient]`. Update CSS variables on viewport pointer movement. Ensure the ambience container uses `pointer-events: none`. Disable particle displacement under `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

Commit:

```bash
git add src/mindmap-ambient.js src/archive-mindmap.js style.css tests/mindmap-ambient.test.mjs
git commit -m "feat: add interactive mindmap particle ambience"
```

### Task 6: Integrated browser verification

**Files:**
- Create: `tests/mindmap-browser.smoke.mjs`
- Modify: `README.md`

- [ ] **Step 1: Add the browser smoke check**

The script must launch installed Chrome and verify:

```js
assert.equal(await page.locator("[data-mindmap-root]").count(), 1);
await page.locator("[data-mindmap-root]").click();
assert.ok(await page.locator(".mindmap-node").count() >= 1);
await page.locator(".mindmap-node").first().click();
assert.ok(await page.locator(".mindmap-edge").count() >= 2);
assert.equal(await page.locator(".mindmap-particle").count(), 72);
```

It must then drag the viewport, click overview, confirm the world transform changes, drag again, click restore, and confirm the transform changes again. Expand to a terminal branch and verify a real pointer click on “回看完整路径” changes the transform.

- [ ] **Step 2: Run all verification**

Run:

```bash
npm test
node tests/mindmap-browser.smoke.mjs
```

Expected: unit suite passes and browser smoke prints `mindmap browser smoke passed`.

- [ ] **Step 3: Verify reduced motion**

Run the smoke script with Playwright context option:

```js
reducedMotion: "reduce"
```

Expected: navigation and expansion still work, while particle displacement and nonessential animations are disabled.

- [ ] **Step 4: Update README and commit**

Document that “思维导图” replaces list mode, tunnel mode remains available, and describe drag, zoom, overview, restore, collapse, and content-view controls.

Commit:

```bash
git add tests/mindmap-browser.smoke.mjs README.md
git commit -m "test: verify progressive mindmap interactions"
```

### Task 7: Final regression and public build check

**Files:**
- Modify only if a verified regression requires correction.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 2: Start local preview**

Run: `python -m http.server 8080`

Expected: homepage responds at `http://localhost:8080/`.

- [ ] **Step 3: Manually verify the approved flow**

Check:

1. Homepage cinematic entry.
2. Per-character hover on homepage and after-film choices.
3. Film playback still exits normally.
4. Review notebook remains unchanged.
5. Prompt archive opens in mindmap mode.
6. Real branches expand up and down.
7. Drag, zoom, overview, restore, collapse, details, and end overview work.
8. Tunnel mode still loads and returns to mindmap mode.
9. Particle interaction is visible and does not block clicks.

- [ ] **Step 4: Commit any verified corrections**

```bash
git add -u
git commit -m "fix: resolve mindmap integration regressions"
```

Skip this commit when no corrections are required.
