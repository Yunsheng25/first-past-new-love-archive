# 《初恋旧爱新欢》项目网站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个以完整成片为入口、片后提供“复盘手记”和“提示词和图片”两个深入方向的响应式项目网站。

**Architecture:** 使用无框架 HTML、CSS 与 ES Modules 构建 hash 路由单页应用。Node 构建脚本把 Obsidian Markdown 与 Canvas 转换成稳定 JSON；浏览器只读取生成数据，不直接访问 D 盘。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、Node.js 24、`node:test`、FFmpeg、localStorage。

---

## 文件结构

```text
index.html                         应用外壳
styles/{tokens,base,film,review,archive,responsive}.css
src/{main,router,data,film,review,archive,storage,ui}.js
scripts/build-review-data.mjs      复盘 Markdown 转 JSON
scripts/build-archive-data.mjs     Canvas 转案例 JSON
scripts/build-site-data.mjs        完整性检查入口
scripts/optimize-video.ps1         网页视频转码
data/{review,archive}.json         生成数据
assets/review-images/              复盘正文图片
assets/video/{hero-background,full-film}.mp4
tests/*.test.mjs
```

### Task 1: 建立版本基线和路由契约

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/router.js`
- Test: `tests/router.test.mjs`

- [ ] **Step 1: 初始化 Git 并保存原型基线**

Run: `git init`，随后 `git add .` 和 `git commit -m "chore: capture existing prototype"`。

Expected: 首个提交成功，不改变现有内容。

- [ ] **Step 2: 创建测试入口**

```json
{
  "name": "first-love-project-archive",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "build:data": "node scripts/build-site-data.mjs"
  }
}
```

`.gitignore` 写入 `.superpowers/`、`preview-server.*.log` 和 `assets/video/*.mp4`。

- [ ] **Step 3: 先写失败的路由测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute } from "../src/router.js";

test("parses approved routes", () => {
  assert.deepEqual(parseRoute(""), { name: "intro" });
  assert.deepEqual(parseRoute("#film"), { name: "film" });
  assert.deepEqual(parseRoute("#after"), { name: "after" });
  assert.deepEqual(parseRoute("#review"), { name: "review-index" });
  assert.deepEqual(parseRoute("#review/production/3"), { name: "review-page", chapter: "production", page: 3 });
  assert.deepEqual(parseRoute("#archive/case-12"), { name: "archive-detail", id: "case-12" });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npm test`

Expected: FAIL，提示 `src/router.js` 不存在。

- [ ] **Step 5: 实现最小路由**

`parseRoute(hash)` 必须支持 `intro`、`film`、`after`、`review-index`、`review-page`、`archive-index`、`archive-detail`；未知地址回到 `intro`。所有动态段使用 `decodeURIComponent`，页码最小为 1。

- [ ] **Step 6: 验证并提交**

Run: `npm test`

Expected: PASS。

Commit: `git commit -am "test: establish route contract"`

### Task 2: 构建分页复盘数据

**Files:**
- Create: `scripts/build-review-data.mjs`
- Create: `data/review.json`
- Create: `assets/review-images/`
- Test: `tests/review-data.test.mjs`

- [ ] **Step 1: 写失败测试**

测试必须读取 `D:/黑曜石/产品资料/《初恋旧爱新欢》视频复盘/《初恋旧爱新欢》复盘手记.md`，断言五个 slug 依次为 `origin`、`story`、`production`、`reflection`、`closing`，每章存在正文，所有分页合并后字符不丢失。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/review-data.test.mjs`

Expected: FAIL，构建模块不存在。

- [ ] **Step 3: 实现解析器**

```js
const CHAPTERS = [
  ["项目缘起：我为什么要做这个视频", "origin"],
  ["故事设计：一个想法怎么变成完整叙事", "story"],
  ["制作执行：生图、视频与剪辑", "production"],
  ["回看成片：我看到的不足", "reflection"],
  ["写在最后", "closing"],
];
```

导出 `parseReview(markdown)`、`paginateBlocks(blocks, limit = 900)` 和 `writeReviewData()`。按标题、段落、Obsidian 图片嵌入生成块；只在块边界分页，每页目标 600–1000 字；输出 UTF-8 `data/review.json`。构建时在 `D:/黑曜石` 中解析 51 处正文图片引用，复制到 `assets/review-images/`，JSON 中写入网站相对路径；任一图片缺失时构建失败并列出文件名。

- [ ] **Step 4: 验证编码和页数**

Run: `node --test tests/review-data.test.mjs` 和 `node scripts/build-review-data.mjs`。

Expected: PASS；JSON 中正常出现“项目缘起”“制作执行”“写在最后”，总页数在 20–30 之间。

- [ ] **Step 5: 提交**

Commit: `git commit -m "feat: build paginated review data"`

### Task 3: 重建图片与提示词案例数据

**Files:**
- Replace: `web-data-utils.mjs`
- Replace: `build-web-data.mjs`
- Create: `scripts/build-archive-data.mjs`
- Create: `data/archive.json`
- Modify: `tests/canvas-data.test.mjs`
- Test: `tests/archive-data.test.mjs`

- [ ] **Step 1: 写失败测试**

从 `D:/黑曜石/canvas白板/《初恋旧爱新欢》视频制作.canvas` 构建数据，断言 72 个案例、137 张不同图片、0 张缺失图片；并测试“首尾帧”“图生视频”“转场”“生图”“剪辑参考”分类。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/archive-data.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 修复乱码并实现构建器**

`web-data-utils.mjs` 只保留 UTF-8 安全的 `imageRefs`、`stripEmbeds`、`slugForImage`。`build-archive-data.mjs` 导出：

```js
export function classifyPromptType(prompt, imageCount) {
  if (/首帧|尾帧/.test(prompt) && imageCount >= 2) return "首尾帧";
  if (/转场|叠化/.test(prompt)) return "转场";
  if (/生成.*视频|视频开始|镜头/.test(prompt)) return "图生视频";
  if (/音效|剪辑|黑场|音乐/.test(prompt)) return "剪辑参考";
  return "生图";
}
```

按白板坐标顺序生成 `case-01` 至 `case-72`；保存标题、完整提示词、类型、场景标签、图片数组和首尾帧角色；复制图片到 `assets/canvas-images/`。同步把旧 `tests/canvas-data.test.mjs` 改为 UTF-8 新接口和当前真实统计，避免旧乱码断言继续污染测试结果。

- [ ] **Step 4: 构建并验证**

Run: `node scripts/build-archive-data.mjs`。

Expected summary: `cases: 72`、`uniqueImages: 137`、`missingImages: 0`。

- [ ] **Step 5: 提交**

Commit: `git commit -m "feat: normalize prompt and image archive"`

### Task 4: 生成网页视频资源

**Files:**
- Create: `scripts/optimize-video.ps1`
- Generate: `assets/video/hero-background.mp4`
- Generate: `assets/video/full-film.mp4`

- [ ] **Step 1: 写转码脚本**

脚本固定使用：

```powershell
$InputVideo = 'D:\chenx\Videos\初恋旧爱新欢.mp4'
$Ffmpeg = 'C:\Users\chenx\AppData\Local\JianyingPro\Apps\10.9.0.14199\ffmpeg.exe'
```

背景视频命令参数：`-an -vf "scale='min(1600,iw)':-2,setpts=0.25*PTS" -c:v libx264 -crf 25 -movflags +faststart -pix_fmt yuv420p`。

完整成片命令参数：`-c:v libx264 -crf 21 -c:a aac -b:a 192k -movflags +faststart -pix_fmt yuv420p`。

脚本必须在输入、FFmpeg 或输出失败时抛出明确中文错误。

- [ ] **Step 2: 执行并验证媒体**

Run: `powershell -ExecutionPolicy Bypass -File scripts/optimize-video.ps1`

Expected: 背景视频无音轨且约为原时长四分之一；完整成片有音轨；两者均小于 370 MB。

- [ ] **Step 3: 提交脚本**

Commit: `git commit -m "build: add reproducible video optimization"`。MP4 由 `.gitignore` 排除。

### Task 5: 实现片头与完整成片播放器

**Files:**
- Replace: `index.html`
- Create: `styles/tokens.css`
- Create: `styles/base.css`
- Create: `styles/film.css`
- Create: `src/main.js`
- Create: `src/film.js`

- [ ] **Step 1: 建立 UTF-8 应用外壳**

`index.html` 只包含 `#app`、`#modal-root`、noscript 提示、六个 CSS 文件和 `src/main.js` module；不再加载旧 `canvas-data.js` 和 `script.js`。

- [ ] **Step 2: 固定批准的视觉变量**

```css
:root {
  --ink: #eee5d8;
  --ink-muted: rgba(238,229,216,.66);
  --night: #07090b;
  --accent: #a8453d;
  --hero-video-opacity: .58;
  --serif: "Songti SC", "SimSun", serif;
  --sans: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
}
```

- [ ] **Step 3: 实现片头**

`renderIntro(root)` 使用 `assets/video/hero-background.mp4` 全屏、静音、循环、`object-fit: cover`。透明度使用变量 `.58`。文字布局复现 `design-references/homepage-approved.png` 的宋体主标题、中英文层级、小红点和居中构图。片头只提供“观看完整成片”，不得提前出现复盘或提示词入口。

- [ ] **Step 4: 实现完整播放器**

`renderFilm(root)` 播放 `assets/video/full-film.mp4`，带 controls、正常速度、正常亮度和声音。监听 `ended` 后导航到 `#after`；监听 `error` 显示“影片加载失败”和重试按钮；提供退出影片。结束事件触发时先把当前视频帧绘制到同尺寸 canvas，以 JPEG data URL 暂存到 `sessionStorage` 的 `film:last-frame`，失败时静默降级为最后画面海报。

- [ ] **Step 5: 集成路由和错误边界**

`src/main.js` 在 `hashchange` 时调用对应渲染器；异常时显示错误说明和返回影片链接；每次路由后把焦点移到 `#app`。

- [ ] **Step 6: 验证并提交**

Expected: 片头与参考图方向一致，视频可见度高于旧 42% 效果；完整成片可正常播放和退出。

Commit: `git commit -m "feat: add cinematic intro and full film player"`

### Task 6: 实现成片结束后的两个选择

**Files:**
- Modify: `src/film.js`
- Modify: `styles/film.css`

- [ ] **Step 1: 实现片后视图**

`renderAfter(root)` 只能显示：结束说明、“复盘手记”、“提示词和图片”和较弱的“重新观看影片”。两个主入口分别指向 `#review` 与 `#archive`。背景优先读取 `sessionStorage['film:last-frame']`，不存在时使用批准参考图作为降级背景。

- [ ] **Step 2: 实现转场**

最后一帧保留约 1 秒并逐渐变暗，文字淡入。桌面两个入口左右排列；760px 以下上下排列；`prefers-reduced-motion` 下立即显示。

- [ ] **Step 3: 验证并提交**

手动拖到影片末尾。Expected: 自动进入 `#after`，只有两个主要选择，重新观看返回 `#film`。

Commit: `git commit -m "feat: add post-film choice experience"`

### Task 7: 实现分页复盘阅读器

**Files:**
- Create: `src/data.js`
- Create: `src/storage.js`
- Create: `src/review.js`
- Create: `styles/review.css`
- Test: `tests/storage.test.mjs`
- Test: `tests/review-pagination.test.mjs`

- [ ] **Step 1: 写失败测试**

测试 `adjacentPage(page, delta, total)` 不越界；测试 localStorage 抛错时 `get` 返回 1 且 `set` 不抛错。

- [ ] **Step 2: 实现安全数据与进度存储**

`loadJson(url)` 检查 HTTP 状态并缓存结果。`createProgressStore(storage)` 使用 `review:<chapter>` 键，所有存储访问包在 try/catch 中。

- [ ] **Step 3: 实现目录与阅读页**

`renderReviewIndex` 显示五章、摘要、阅读时间和继续阅读位置。`renderReviewPage` 显示可收起目录、正文块、图片、页码、上一页/下一页、返回目录和返回片后选择。正文必须通过 `textContent` 或转义函数输出。

- [ ] **Step 4: 实现阅读样式**

正文最大宽度 42rem，行高 1.85–2.0；桌面显示目录栏，手机收起；图片可放大；页码控制固定稳定，不产生无限长页面。

- [ ] **Step 5: 测试并提交**

Run: `npm test`。Expected: PASS。

Commit: `git commit -m "feat: add paginated review reader"`

### Task 8: 实现可搜索的图片提示词案例库

**Files:**
- Create: `src/archive.js`
- Create: `src/ui.js`
- Create: `styles/archive.css`
- Test: `tests/archive-filter.test.mjs`

- [ ] **Step 1: 写失败的搜索筛选测试**

测试查询同时匹配标题、完整提示词和标签；测试查询与类型筛选组合；测试无结果返回空数组。

- [ ] **Step 2: 实现纯筛选函数**

```js
export function filterCases(cases, query = "", type = "全部") {
  const needle = query.trim().toLowerCase();
  return cases.filter((item) => {
    const haystack = [item.title, item.prompt, ...(item.tags || [])].join(" ").toLowerCase();
    return (!needle || haystack.includes(needle)) && (type === "全部" || item.type === type);
  });
}
```

- [ ] **Step 3: 实现案例总览**

显示六个筛选、搜索框、结果数、懒加载代表图、类型、图片数量和标签。无结果时显示“清除筛选”。不得只展示精选内容。

- [ ] **Step 4: 实现案例详情**

显示完整图片组和完整提示词。首尾帧案例明确标记首帧/尾帧；其他案例标记图 1、图 2。复制失败时选中文字并提示手动复制。提供放大、上一个、下一个、全部案例和返回片后选择。

- [ ] **Step 5: 测试并提交**

Run: `npm test`。Expected: PASS。

Commit: `git commit -m "feat: add searchable prompt and image archive"`

### Task 9: 响应式、完整性和最终验证

**Files:**
- Create: `styles/responsive.css`
- Create: `scripts/build-site-data.mjs`
- Modify: integration files as verification requires

- [ ] **Step 1: 创建总构建入口**

依次调用 `writeReviewData()` 和 `writeArchiveData()`，然后断言：5 个复盘章节、复盘总页数 20–30、51 处复盘图片全部解析、72 个案例、137 张不同图片、0 张缺失图片。再按图片原始文件名匹配复盘图片块与档案案例，为可匹配的复盘块写入 `caseId`，从而生成双向案例链接；无法匹配的内容保持独立阅读。任一完整性条件不满足时退出码非零。

- [ ] **Step 2: 完成响应式和减少动画规则**

覆盖 1180、900、760、480px。760px 以下：片后选项纵向、复盘目录折叠、档案详情单列、标题不溢出。减少动画模式关闭淡入缩放。

- [ ] **Step 3: 运行自动验证**

Run: `npm test` 和 `npm run build:data`。

Expected: 全部 PASS；输出 5 chapters、72 cases、137 unique images、0 missing images。

- [ ] **Step 4: 浏览器完整流程验证**

在 1600×1000、1280×800、390×844 下验证：片头、正常成片、片后双选项、五章翻页、阅读进度、搜索“婚礼/病房/老人”、首尾帧标签、复制提示词、图片放大、所有返回链接和禁止自动播放时的降级。

- [ ] **Step 5: 截图核对**

为片头、片后选择、复盘目录、阅读页、案例总览、案例详情生成桌面和手机截图。片头对比 `design-references/homepage-approved.png`，只允许在 55%–65% 内微调视频透明度，不改变批准的信息流程。

- [ ] **Step 6: 清理旧入口并最终提交**

确认新代码没有引用后，删除旧 `script.js`、`style.css`、`canvas-data.js`、`canvas-data.json`。保留 `output/` 构建输入。

Run: `git status --short`。

Expected: 最终提交后工作区干净，MP4 被忽略。

Commit: `git commit -m "feat: complete first love project archive"`

---

## 完成定义

- 片头、完整成片和片后双选项均可运行。
- 复盘 5 章、20–30 个阅读页面完整生成。
- 72 个案例、137 张不同图片、0 张缺失图片。
- 全部自动测试通过。
- 桌面和手机均无乱码、溢出、遮挡或无效链接。
- 首页保持批准参考图的文字设计，视频透明度不会低到看不清。
