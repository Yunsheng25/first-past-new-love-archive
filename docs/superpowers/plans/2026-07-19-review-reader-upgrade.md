# 复盘阅读器升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把复盘阅读器改成暖炭黑纸面、章标题只出现一次、缓存后无加载闪屏，并加入约 0.62 秒的克制 3D 翻页。

**Architecture:** `review-reader.js` 保留内容渲染与媒体顺序，新增可同步读取的模块级数据缓存；`script.js` 用 View Transition API 包裹同一阅读器内的 Hash 路由切换，并在不支持时使用 CSS 淡入。章节首页由 `buildReviewPage()` 的 `pageIndex === 0` 决定，不改 `review.json`。

**Tech Stack:** 原生 ES Modules、CSS View Transitions/3D transforms、`node:test`、现有 `data/review.json` 和 Hash 路由。

---

## 文件结构

- Modify: `src/review-reader.js` — 缓存、章节首页标记、翻页链接方向与同步渲染。
- Modify: `script.js` — 同一复盘页之间的 View Transition 路由包装。
- Modify: `style.css` — 暖炭黑纸面、标题层级、翻页动画和 reduced-motion。
- Modify: `tests/review-reader-ui.test.mjs` — 标题、缓存、媒体顺序与交互测试。
- Modify: `tests/review-data.test.mjs` — 继续锁定 51 个媒体 occurrence 的签名。
- Modify: `tests/responsive-layout.test.mjs` — 移动端阅读器无溢出。

### Task 1: 让章节大标题只出现在第一页

**Files:**
- Modify: `src/review-reader.js`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: 写失败测试**

构造同章第 1、2 页 target，断言第一页含 `review-chapter-opener`、章节 `h1`，第二页不含 opener，只含当前小节标题和 `data-review-page="continuation"`。

```js
test('章节大标题只在本章第一页出现', () => {
  const data = reviewFixture();
  const first = buildReviewPage(data, normalizeReviewTarget(data, data.chapters[0].slug, 1));
  const second = buildReviewPage(data, normalizeReviewTarget(data, data.chapters[0].slug, 2));
  assert.match(first, /class="review-chapter-opener"/);
  assert.match(first, /id="review-reader-title"/);
  assert.match(first, /data-review-page="opener"/);
  assert.doesNotMatch(second, /review-chapter-opener/);
  assert.match(second, /data-review-page="continuation"/);
});
```

- [ ] **Step 2: 运行并确认第二页仍含章节 `h1`**

Run: `node --test tests/review-reader-ui.test.mjs`
Expected: FAIL，第二页匹配到 `review-paper-content > h1`。

- [ ] **Step 3: 修改 `buildReviewPage()`**

计算 `const isChapterOpener = pageIndex === 0;`，把 article 开头改为：

```js
const opener = isChapterOpener ? `
  <header class="review-chapter-opener">
    <p class="review-paper-kicker">CHAPTER ${String(chapterIndex + 1).padStart(2, '0')}</p>
    <h1 id="review-reader-title">${escapeHtml(chapter.title)}</h1>
  </header>` : '';

// article
`<article class="review-paper-content" data-review-page="${isChapterOpener ? 'opener' : 'continuation'}">
  ${opener}
  <div class="review-blocks"${isChapterOpener ? '' : ' aria-labelledby="review-section-title"'}>${renderedBlocks}</div>
</article>`;
```

把 `blockMarkup()` 签名从：

```js
function blockMarkup(block, blockIndex, chapterSlug, page)
```

改为：

```js
function blockMarkup(block, blockIndex, chapterSlug, page, { sectionTitle = false } = {})
```

并把现有 heading 分支的 return 精确替换为：

```js
return `<h${level}${sectionTitle ? ' id="review-section-title"' : ''} class="review-block review-heading" ${common}>${renderInlineMarkdown(block.text)}</h${level}>`;
```

最后把现有 `renderedBlocks` 的 map 精确替换为：

```js
const firstHeadingIndex = blocks.findIndex((block) => block.type === 'heading');
const renderedBlocks = blocks.map((block, blockIndex) => blockMarkup(
  block, blockIndex, chapter.slug, pageIndex + 1,
  { sectionTitle: !isChapterOpener && blockIndex === firstHeadingIndex },
)).join('\n');
```

- [ ] **Step 4: 运行测试**

Run: `node --test tests/review-reader-ui.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交标题层级**

```bash
git add src/review-reader.js tests/review-reader-ui.test.mjs
git commit -m "fix: show review chapter title once"
```

### Task 2: 增加可同步命中的数据缓存

**Files:**
- Modify: `src/review-reader.js`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: 写缓存失败测试**

新增导出 `loadReviewData()`、`peekReviewData()`、`resetReviewDataCache()`，测试同一个 `fetchImpl` 只调用一次；成功后 `peek` 同步返回；失败会清缓存并允许重试。

```js
test('复盘数据成功后可同步复用，失败后可重试', async () => {
  resetReviewDataCache();
  let calls = 0;
  const data = reviewFixture();
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => data }; };
  assert.equal(peekReviewData(fetchImpl), null);
  assert.equal(await loadReviewData(fetchImpl), data);
  assert.equal(await loadReviewData(fetchImpl), data);
  assert.equal(peekReviewData(fetchImpl), data);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: 运行并确认导出不存在**

Run: `node --test tests/review-reader-ui.test.mjs`
Expected: FAIL，缺少缓存函数。

- [ ] **Step 3: 实现按 `fetchImpl` 隔离的缓存**

在模块顶部添加：

```js
let reviewDataEntries = new Map();

export function peekReviewData(fetchImpl = fetch) {
  return reviewDataEntries.get(fetchImpl)?.data ?? null;
}

export function resetReviewDataCache() {
  reviewDataEntries = new Map();
}

export function loadReviewData(fetchImpl = fetch, { force = false } = {}) {
  const cached = reviewDataEntries.get(fetchImpl);
  if (!force && cached?.data) return Promise.resolve(cached.data);
  if (!force && cached?.promise) return cached.promise;
  const entry = { data: null, promise: null };
  entry.promise = Promise.resolve(fetchImpl('data/review.json')).then(async (response) => {
    if (!response.ok) throw new Error(`Review data request failed: ${response.status}`);
    entry.data = await response.json();
    return entry.data;
  }).catch((error) => {
    if (reviewDataEntries.get(fetchImpl) === entry) reviewDataEntries.delete(fetchImpl);
    throw error;
  });
  reviewDataEntries.set(fetchImpl, entry);
  return entry.promise;
}
```

- [ ] **Step 4: 修改 `mountReviewRoute()` 避免缓存命中时显示 loading**

把 `load()` 开头改为先读 `peekReviewData(fetchImpl)`；命中时同步调用内部 `renderData(data)`，不写 `loadingView()`；未命中才显示加载页并 await `loadReviewData(fetchImpl)`。重试使用 `{ force: true }`。

```js
const renderData = (data) => {
  if (route.name === 'review-index') app.innerHTML = buildReviewIndex(data, readReviewProgress(storage));
  else {
    const target = normalizeReviewTarget(data, route.chapter, route.page);
    app.innerHTML = target ? buildReviewPage(data, target) : missingChapterView();
    if (target) writeReviewProgress(storage, { chapter: target.chapter.slug, page: target.page });
  }
  interactionCleanup = bindReviewInteractions(app, { documentRef, windowRef });
};
```

- [ ] **Step 5: 运行测试并提交缓存**

Run: `node --test tests/review-reader-ui.test.mjs`
Expected: PASS，且缓存命中测试确认不出现 `data-review-loading`。

```bash
git add src/review-reader.js tests/review-reader-ui.test.mjs
git commit -m "perf: cache review pages after first load"
```

### Task 3: 加入方向正确的 3D 翻页路由

**Files:**
- Modify: `script.js`
- Modify: `src/review-reader.js`
- Modify: `style.css`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: 写方向标记与动画锁失败测试**

给上一页/下一页链接分别添加 `data-review-direction="previous|next"`，并在读取 `script.js`/`style.css` 的测试中断言存在 `startViewTransition`、`review-turn-next`、`review-turn-previous`、`620ms` 与 reduced-motion fallback。

```js
assert.match(pageHtml, /data-review-next[^>]*data-review-direction="next"/);
assert.match(pageHtml, /data-review-prev[^>]*data-review-direction="previous"/);
assert.match(scriptSource, /startViewTransition/);
assert.match(cssSource, /review-turn-next/);
assert.match(cssSource, /620ms/);
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/review-reader-ui.test.mjs`
Expected: FAIL，缺少方向与 View Transition。

- [ ] **Step 3: 为链接添加方向属性**

将 `navigationLink()` 返回值改为：

```js
const turnDirection = direction === 'previous' ? 'previous' : 'next';
return `<a href="${href}" ${attribute} data-review-direction="${turnDirection}">${label}</a>`;
```

- [ ] **Step 4: 在 `script.js` 记录翻页意图并包裹 hashchange**

新增 `currentRenderedRoute`、`pendingReviewDirection` 和 `reviewTransitionBusy`。点击方向链接时只记录方向；Hash 变化时，如果旧、新路由均为 `review-page`、缓存已命中、未开启 reduced motion 且支持 `document.startViewTransition`，给 `<html>` 添加方向 class 并同步 `renderRoute(nextRoute)`。

```js
function renderHashChange() {
  const nextRoute = currentRoute();
  const direction = pendingReviewDirection;
  pendingReviewDirection = null;
  const canTurn = direction && currentRenderedRoute?.name === 'review-page'
    && nextRoute.name === 'review-page'
    && typeof document.startViewTransition === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canTurn || reviewTransitionBusy) { renderRoute(nextRoute); currentRenderedRoute = nextRoute; return; }
  reviewTransitionBusy = true;
  document.documentElement.classList.add(`review-turn-${direction}`);
  const transition = document.startViewTransition(() => renderRoute(nextRoute));
  transition.finished.finally(() => {
    document.documentElement.classList.remove(`review-turn-${direction}`);
    reviewTransitionBusy = false;
  });
  currentRenderedRoute = nextRoute;
}
```

- [ ] **Step 5: 添加 0.62 秒 CSS 3D 动画与淡入降级**

给 `.review-paper` 设置 `view-transition-name: review-paper`；旧页面做约 82° Y 轴翻出和中段阴影，新页面轻微淡入。上一页反向。reduced-motion 下禁用 View Transition 名称并使用 0.2 秒 opacity。

```css
.review-paper { view-transition-name: review-paper; }
::view-transition-group(review-paper) { animation-duration: 620ms; animation-timing-function: cubic-bezier(.52,.08,.28,.98); perspective: 1800px; }
.review-turn-next::view-transition-old(review-paper) { transform-origin: left center; animation: review-out-next 620ms cubic-bezier(.52,.08,.28,.98); }
.review-turn-previous::view-transition-old(review-paper) { transform-origin: right center; animation: review-out-previous 620ms cubic-bezier(.52,.08,.28,.98); }
@keyframes review-out-next { to { transform: perspective(1800px) rotateY(-82deg); opacity: .18; } }
@keyframes review-out-previous { to { transform: perspective(1800px) rotateY(82deg); opacity: .18; } }
@media (prefers-reduced-motion: reduce) { .review-paper { view-transition-name: none; } }
```

- [ ] **Step 6: 运行测试并提交翻页**

Run: `node --test tests/review-reader-ui.test.mjs tests/router.test.mjs`
Expected: PASS。

```bash
git add script.js src/review-reader.js style.css tests/review-reader-ui.test.mjs
git commit -m "feat: add smooth review page turns"
```

### Task 4: 应用暖炭黑阅读主题

**Files:**
- Modify: `style.css`
- Modify: `tests/review-reader-ui.test.mjs`
- Modify: `tests/responsive-layout.test.mjs`

- [ ] **Step 1: 写颜色与标题布局失败断言**

断言 `.review-paper` 不再使用白/浅纸色，正文变量为暖灰白；`.review-chapter-opener` 仅有第一页的大字号；continuation 的顶部留白明显更小。

```js
assert.match(css, /\.review-paper\s*\{[\s\S]*background:\s*#25211e/);
assert.match(css, /\.review-chapter-opener/);
assert.match(css, /data-review-page="continuation"/);
assert.doesNotMatch(css, /\.review-paper\s*\{[^}]*background:\s*#f/i);
```

- [ ] **Step 2: 运行并确认当前浅色纸面导致失败**

Run: `node --test tests/review-reader-ui.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 替换阅读区色板和间距**

将 `.review-reader-view`、sidebar、`.review-paper`、meta、正文、导航统一改为近黑/暖炭灰。使用以下固定核心色：页面 `#0d0c0b`、纸面 `#25211e`、正文 `#c9beb2`、主标题 `#eee4d8`、强调 `#aa8c77`。媒体自身不套统一透明度。

- [ ] **Step 4: 运行媒体顺序与响应式测试**

Run: `node --test tests/review-reader-ui.test.mjs tests/review-data.test.mjs tests/responsive-layout.test.mjs`
Expected: PASS；51 个媒体 occurrence 签名完全不变。

- [ ] **Step 5: 提交主题**

```bash
git add style.css tests/review-reader-ui.test.mjs tests/responsive-layout.test.mjs
git commit -m "style: integrate the review reader with the dark site"
```

### Task 5: 完整回归和真实浏览器验收

**Files:**
- Modify: `src/review-reader.js`
- Modify: `script.js`
- Modify: `style.css`
- Modify: `tests/review-reader-ui.test.mjs`
- Modify: `tests/responsive-layout.test.mjs`

- [ ] **Step 1: 重建并锁定内容**

Run: `npm run build:data`
Expected: 构建成功；复盘 51 次媒体引用、25 图片、26 视频；顺序签名不变。

- [ ] **Step 2: 运行全部测试**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 3: 桌面端验收**

依次翻过同章第 1、2、3 页与跨章边界：大标题只在第一页；后续页无加载画面；动画约 0.62 秒；快速连点不会错页；图片和视频仍在原位；视频翻页离开时暂停。

- [ ] **Step 4: 手机和 reduced-motion 验收**

检查小节目录、正文行宽、媒体、底部导航无溢出；开启“减少动态”后只淡入，无 3D 翻页。

- [ ] **Step 5: 提交验收修正**

```bash
git add src/review-reader.js script.js style.css tests/review-reader-ui.test.mjs tests/review-data.test.mjs tests/responsive-layout.test.mjs
git commit -m "test: verify review reader transitions"
```
