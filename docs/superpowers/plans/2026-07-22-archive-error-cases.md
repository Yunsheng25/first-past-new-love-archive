# Archive Error Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the two authored failure groups in their original archive positions while marking them clearly as error attempts.

**Architecture:** Derive error status from existing Canvas group containment during data generation. Carry `status` and `errorGroup` through occurrences and render them consistently in tunnel cards, list cards and the complete case modal without changing archive order.

**Tech Stack:** Obsidian Canvas JSON, Node data builder, static renderer, CSS, Node test runner.

---

### Task 1: Derive error semantics from Canvas groups

**Files:**
- Modify: `scripts/web-data-utils.mjs`
- Test: `tests/canvas-data.test.mjs`
- Test: `tests/archive-data.test.mjs`

- [ ] **Step 1: Add failing group-containment tests**

Build fixture groups named `出现人脸` and `人物呈现的形象特征与前方不符`, with nodes inside, on the boundary, and outside. Assert inside cases receive the exact group label while order remains visual `y, x, nodeId`.

```js
assert.equal(byId.get('inside-face').status, 'error');
assert.equal(byId.get('inside-face').errorGroup, '出现人脸');
assert.equal(byId.get('outside').status, 'normal');
assert.deepEqual(result.cases.map((item) => item.source.nodeId), expectedOrder);
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/canvas-data.test.mjs tests/archive-data.test.mjs`.

- [ ] **Step 3: Add exact error-group classification**

```js
const ERROR_GROUP_LABELS = new Set(['出现人脸', '人物呈现的形象特征与前方不符']);
const containingGroups = groupIdsForNode(node, groups);
const errorGroup = containingGroups.find((group) => ERROR_GROUP_LABELS.has(group.label))?.label ?? null;
```

Return `status: errorGroup ? 'error' : 'normal'` and `errorGroup`, while retaining all existing `source.groups` and ordering.

- [ ] **Step 4: Lock the real-source classification**

For the real Canvas, independently compute geometric membership and assert every expected node is marked, no external node is marked, and archive totals remain 72/138/137.

- [ ] **Step 5: Rebuild and commit**

Run: `npm.cmd run build:data`  
Run: `node --test tests/canvas-data.test.mjs tests/archive-data.test.mjs`  
Expected: PASS.

```powershell
git add scripts/web-data-utils.mjs data/archive.json tests/canvas-data.test.mjs tests/archive-data.test.mjs
git commit -m "fix: preserve authored archive error groups"
```

### Task 2: Carry error status through every archive view

**Files:**
- Modify: `src/archive-tunnel-data.js`
- Modify: `src/archive-ui.js`
- Modify: `src/archive-case-modal.js`
- Modify: `style.css`
- Test: `tests/archive-tunnel.test.mjs`
- Test: `tests/archive-ui.test.mjs`
- Test: `tests/archive-case-modal.test.mjs`

- [ ] **Step 1: Add failing rendering tests**

Assert error occurrences carry `status/errorGroup`; tunnel/list cards include visible text `错误尝试`; normal cases do not; modal includes the exact group as failure reason and retains full prompt/images.

```js
assert.equal(errorOccurrence.status, 'error');
assert.match(errorModal, /错误尝试/);
assert.match(errorModal, /人物呈现的形象特征与前方不符/);
assert.doesNotMatch(normalModal, /错误尝试/);
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/archive-tunnel.test.mjs tests/archive-ui.test.mjs tests/archive-case-modal.test.mjs`.

- [ ] **Step 3: Propagate immutable metadata**

Add `status` and `errorGroup` to each flattened occurrence. Render a textual badge in tunnel/list output and an error header block in modal output. Escape `errorGroup` with the existing HTML escaper.

- [ ] **Step 4: Add scoped error styling**

Use a thin muted-red border and compact `错误尝试` badge. Do not tint or reduce opacity of the image. Ensure the badge remains visible on mobile and is not color-only.

- [ ] **Step 5: Verify and commit**

Run focused tests, `npm.cmd test`, and `git diff --check`.  
Expected: all PASS.

```powershell
git add src/archive-tunnel-data.js src/archive-ui.js src/archive-case-modal.js style.css tests/archive-tunnel.test.mjs tests/archive-ui.test.mjs tests/archive-case-modal.test.mjs
git commit -m "feat: label archive error attempts in place"
```

