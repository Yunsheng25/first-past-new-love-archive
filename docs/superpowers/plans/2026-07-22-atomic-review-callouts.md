# Atomic Review Callouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every Obsidian NOTE title, label, image and video inside one ordered, indivisible review annotation card.

**Architecture:** Parse quoted NOTE ranges into a single `callout` block with ordered `children`. Pagination treats that block as one semantic unit; the reader recursively renders its children inside one `<aside>` and gives oversized callouts an internal scroll region.

**Tech Stack:** Node Markdown parser, generated JSON, static HTML renderer, CSS, Node test runner.

---

### Task 1: Parse NOTE blocks as structured callouts

**Files:**
- Modify: `scripts/build-review-data.mjs`
- Test: `tests/review-data.test.mjs`

- [ ] **Step 1: Add a failing parser fixture**

Use a NOTE containing a title, text before an image, two images, an inline label, and a video. Assert one top-level block and exact child order.

```js
assert.deepEqual(chapter.blocks[0], {
  type: 'callout', kind: 'NOTE', title: '示例', section: '制作执行',
  children: [
    { type: 'text', text: '原首尾帧：', section: '制作执行' },
    { type: 'image', rawRef: 'first.png', section: '制作执行' },
    { type: 'image', rawRef: 'last.png', section: '制作执行' },
    { type: 'text', text: '生成结果：', section: '制作执行' },
    { type: 'video', rawRef: 'result.mp4', section: '制作执行' },
  ],
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/review-data.test.mjs`  
Expected: FAIL because current parsing flattens quote lines.

- [ ] **Step 3: Implement a quote-aware state machine**

Add `parseCallout(lines, section)` that recognizes `> [!NOTE] title`, strips exactly one quote marker from subsequent quoted lines, and delegates the body to `blocksForParagraph` without flattening its returned children.

```js
function calloutBlock(lines, section) {
  const [, kind, title = ''] = lines[0].match(/^>\s*\[!([^\]]+)\]\s*(.*)$/) || [];
  if (!kind) return null;
  const body = lines.slice(1).map((line) => line.replace(/^>\s?/, ''));
  return { type: 'callout', kind, title, section, children: blocksForParagraph(body, section) };
}
```

Collect consecutive quoted lines before ordinary paragraph handling. Preserve blank quoted lines inside the callout.

- [ ] **Step 4: Assign media sources recursively**

Replace the flat loop with a recursive walker:

```js
function visitBlocks(blocks, visit) {
  for (const block of blocks) {
    visit(block);
    if (block.type === 'callout') visitBlocks(block.children, visit);
  }
}
```

Use it for source assignment, media counts, summary text and character counts.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/review-data.test.mjs tests/site-data-entry.test.mjs`  
Expected: PASS.

```powershell
git add scripts/build-review-data.mjs tests/review-data.test.mjs
git commit -m "fix: preserve review annotations as structured blocks"
```

### Task 2: Keep callouts atomic during pagination

**Files:**
- Modify: `scripts/build-review-data.mjs`
- Test: `tests/review-data.test.mjs`

- [ ] **Step 1: Add failing pagination tests**

Assert a callout moves wholly to the next page when it does not fit and remains one block when its own measured size exceeds the page limit.

```js
assert.equal(pages[0].some((block) => block.type === 'callout'), false);
assert.equal(pages[1].filter((block) => block.type === 'callout').length, 1);
assert.deepEqual(pages[1][0].children.map((child) => child.type), ['text', 'image', 'video']);
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/review-data.test.mjs`.

- [ ] **Step 3: Make sizing recursive and callouts single units**

```js
function blockSize(block) {
  if (block.type === 'callout') return 180 + block.children.reduce((sum, child) => sum + blockSize(child), 0);
  if (block.type === 'image' || block.type === 'video') return 260;
  return String(block.text || '').length;
}
```

`semanticUnits()` must emit `[callout]` without appending or splitting children.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/review-data.test.mjs`  
Expected: PASS.

```powershell
git add scripts/build-review-data.mjs tests/review-data.test.mjs
git commit -m "fix: paginate review annotations atomically"
```

### Task 3: Render and style one complete annotation frame

**Files:**
- Modify: `src/review-reader.js`
- Modify: `style.css`
- Test: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Add failing markup and CSS tests**

Assert one `aside.review-callout`, a visible “批注” label, escaped original title, ordered child occurrences, no child outside the aside, and scoped max-height/overflow rules for oversized callouts.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/review-reader-ui.test.mjs`.

- [ ] **Step 3: Render callout children recursively**

Split media/text rendering into `blockMarkup`; add:

```js
if (block.type === 'callout') {
  const children = block.children.map((child, index) =>
    blockMarkup(child, `${blockIndex}-${index}`, chapterSlug, page)).join('');
  return `<aside class="review-block review-callout" ${common}>
    <header><span>批注</span><strong>${escapeHtml(block.title || '示例')}</strong></header>
    <div class="review-callout-body">${children}</div>
  </aside>`;
}
```

- [ ] **Step 4: Add scoped warm-charcoal styles**

Use one border/background for the entire aside. Make `.review-callout-body` the only scrolling element when the callout exceeds the page; keep child media at `opacity:1; filter:none`.

- [ ] **Step 5: Rebuild, verify and commit**

Run: `npm.cmd run build:data`  
Run: `node --test tests/review-data.test.mjs tests/review-reader-ui.test.mjs`  
Run: `npm.cmd test`  
Expected: all PASS and 51 authored media occurrences remain present.

```powershell
git add data/review.json src/review-reader.js style.css tests/review-data.test.mjs tests/review-reader-ui.test.mjs
git commit -m "feat: frame complete review annotations"
```

