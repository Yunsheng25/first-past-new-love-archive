# BGM 与成片退出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为网站加入原创极简钢琴 BGM、持久化音乐开关，以及始终可用的成片退出按钮和 `Esc` 退出。

**Architecture:** 使用一个常驻于 `#app` 外部的音乐按钮和独立 `audio-manager` 状态机管理 BGM；路由只通知其进入或离开影片。影片退出由 `after-film.js` 中独立、可清理的控制器处理，确保退出立即暂停并进入 `#after`。

**Tech Stack:** 原生 ES Modules、Web Audio/HTMLAudioElement、Node.js WAV 生成脚本、`node:test`、现有 Hash 路由与 CSS。

---

## 文件结构

- Create: `src/audio-manager.js` — BGM 偏好、首次手势、淡入淡出和影片互斥。
- Create: `scripts/generate-bgm.mjs` — 生成项目自有的无缝极简钢琴 WAV。
- Create: `assets/audio/memory-piano.wav` — 由脚本生成并纳入版本控制。
- Create: `tests/audio-manager.test.mjs` — 音乐状态机和生成音频验证。
- Modify: `index.html` — 在 `#app` 外放置常驻音乐按钮。
- Modify: `src/views.js` — 将影片“返回片头”改为明确“退出影片”。
- Modify: `src/after-film.js` — 添加退出控制器。
- Modify: `script.js` — 连接路由、BGM 与影片退出清理。
- Modify: `style.css` — 音乐按钮、退出按钮和移动端安全区。
- Modify: `tests/intro-film-ui.test.mjs` — 校验常驻控件与影片标记。
- Modify: `tests/after-film.test.mjs` — 校验点击、`Esc`、暂停与清理。

### Task 1: 生成并验证原创 BGM 资产

**Files:**
- Create: `tests/audio-manager.test.mjs`
- Create: `scripts/generate-bgm.mjs`
- Create: `assets/audio/memory-piano.wav`

- [ ] **Step 1: 写会失败的 WAV 资产测试**

在 `tests/audio-manager.test.mjs` 写入：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('原创钢琴 BGM 是可循环的本地 PCM WAV', async () => {
  const wav = await readFile(new URL('../assets/audio/memory-piano.wav', import.meta.url));
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  const sampleRate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const bits = wav.readUInt16LE(34);
  const dataBytes = wav.readUInt32LE(40);
  const duration = dataBytes / (sampleRate * channels * bits / 8);
  assert.equal(sampleRate, 44100);
  assert.equal(channels, 2);
  assert.equal(bits, 16);
  assert.ok(duration >= 31.9 && duration <= 32.1);
});
```

- [ ] **Step 2: 运行测试并确认因资产不存在而失败**

Run: `node --test tests/audio-manager.test.mjs`
Expected: FAIL，错误包含 `ENOENT` 和 `assets/audio/memory-piano.wav`。

- [ ] **Step 3: 实现确定性的 32 秒钢琴循环生成器**

在 `scripts/generate-bgm.mjs` 写入完整生成逻辑：

```js
import { mkdir, writeFile } from 'node:fs/promises';

const sampleRate = 44100;
const seconds = 32;
const channels = 2;
const frames = sampleRate * seconds;
const pcm = Buffer.alloc(frames * channels * 2);
const notes = [
  [0, 52], [0, 59], [0, 64], [4, 55], [4, 60], [4, 64],
  [8, 48], [8, 55], [8, 60], [12, 50], [12, 57], [12, 62],
  [16, 52], [16, 59], [16, 64], [20, 55], [20, 60], [20, 67],
  [24, 48], [24, 55], [24, 64], [28, 50], [28, 57], [28, 62],
];
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const voice = (time, start, midi) => {
  const age = time - start;
  if (age < 0 || age >= 4) return 0;
  const attack = Math.min(1, age / 0.025);
  const release = Math.min(1, (4 - age) / 0.7);
  const envelope = attack * release * Math.exp(-age * 0.72);
  const phase = 2 * Math.PI * frequency(midi) * age;
  return envelope * (Math.sin(phase) + 0.32 * Math.sin(phase * 2.01) + 0.12 * Math.sin(phase * 3.97));
};
for (let frame = 0; frame < frames; frame += 1) {
  const time = frame / sampleRate;
  const sample = Math.tanh(notes.reduce((sum, [start, midi]) => sum + voice(time, start, midi), 0) * 0.22);
  const edge = Math.min(1, time / 0.03, (seconds - time) / 0.03);
  const value = Math.round(Math.max(-1, Math.min(1, sample * edge)) * 32767);
  pcm.writeInt16LE(value, frame * 4);
  pcm.writeInt16LE(value, frame * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
await mkdir(new URL('../assets/audio/', import.meta.url), { recursive: true });
await writeFile(new URL('../assets/audio/memory-piano.wav', import.meta.url), Buffer.concat([header, pcm]));
```

- [ ] **Step 4: 生成资产并验证测试通过**

Run: `node scripts/generate-bgm.mjs`
Expected: 创建 `assets/audio/memory-piano.wav`。
Run: `node --test tests/audio-manager.test.mjs`
Expected: PASS，1 test。

- [ ] **Step 5: 提交音频资产**

```bash
git add scripts/generate-bgm.mjs assets/audio/memory-piano.wav tests/audio-manager.test.mjs
git commit -m "feat: add original piano ambience"
```

### Task 2: 实现 BGM 状态机

**Files:**
- Create: `src/audio-manager.js`
- Modify: `tests/audio-manager.test.mjs`

- [ ] **Step 1: 为偏好、首次手势和影片互斥写失败测试**

追加测试，使用带 `playCalls`、`pauseCalls`、`volume`、`muted` 的 fake audio，验证：初始不播放；`startFromGesture()` 播放；`enterFilm()` 淡出并暂停；`leaveFilm()` 按偏好恢复；`toggle()` 写入 `bgm:enabled`；存储值 `false` 时不恢复。

```js
import { createAudioManager, BGM_PREFERENCE_KEY } from '../src/audio-manager.js';

test('BGM 只在手势后播放，并与影片声音互斥', async () => {
  const values = new Map();
  const audio = {
    volume: 0, loop: false, paused: true, playCalls: 0, pauseCalls: 0,
    play() { this.paused = false; this.playCalls += 1; return Promise.resolve(); },
    pause() { this.paused = true; this.pauseCalls += 1; },
  };
  const manager = createAudioManager({
    audio,
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    fade: async (target) => { audio.volume = target; },
  });
  assert.equal(audio.playCalls, 0);
  await manager.startFromGesture();
  assert.equal(audio.playCalls, 1);
  await manager.enterFilm();
  assert.equal(audio.pauseCalls, 1);
  await manager.leaveFilm();
  assert.equal(audio.playCalls, 2);
  await manager.toggle();
  assert.equal(values.get(BGM_PREFERENCE_KEY), 'false');
});

test('BGM 加载失败只禁用音乐，不抛出到页面', async () => {
  const audio = { volume: 0, paused: true, loop: false, play: () => Promise.reject(new Error('decode failed')), pause() {} };
  const manager = createAudioManager({ audio, storage: null, fade: async (target) => { audio.volume = target; } });
  assert.equal(await manager.startFromGesture(), false);
  assert.equal(manager.state().unavailable, true);
});
```

- [ ] **Step 2: 运行并确认导入失败**

Run: `node --test tests/audio-manager.test.mjs`
Expected: FAIL，`src/audio-manager.js` 不存在。

- [ ] **Step 3: 实现 `src/audio-manager.js`**

实现并导出 `BGM_PREFERENCE_KEY`、`createVolumeFade()` 和 `createAudioManager()`；公开接口固定为：

```js
export const BGM_PREFERENCE_KEY = 'bgm:enabled';
export const BGM_VOLUME = 0.14;

export function createVolumeFade({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  return (audio, target, duration = 480) => new Promise((resolve) => {
    const start = Number(audio.volume) || 0;
    const startedAt = Date.now();
    let timer = null;
    const step = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      audio.volume = start + (target - start) * progress;
      if (progress >= 1) { resolve(); return; }
      timer = schedule(step, 16);
    };
    step();
    void timer;
  });
}

export function createAudioManager({ audio, storage = localStorage, fade } = {}) {
  const player = audio ?? new Audio('assets/audio/memory-piano.wav');
  const runFade = fade ?? ((target, duration) => createVolumeFade()(player, target, duration));
  let enabled = storage?.getItem(BGM_PREFERENCE_KEY) !== 'false';
  let gestureReceived = false;
  let filmActive = false;
  let unavailable = false;
  player.loop = true;
  player.volume = 0;
  const resume = async () => {
    if (!enabled || !gestureReceived || filmActive || unavailable) return false;
    try {
      await player.play();
      await runFade(BGM_VOLUME, 480);
      return true;
    } catch {
      unavailable = true;
      player.pause();
      return false;
    }
  };
  return {
    async startFromGesture() { gestureReceived = true; return resume(); },
    async enterFilm() { filmActive = true; await runFade(0, 360); player.pause(); },
    async leaveFilm() { filmActive = false; return resume(); },
    async toggle() {
      enabled = !enabled;
      storage?.setItem(BGM_PREFERENCE_KEY, String(enabled));
      if (!enabled) { await runFade(0, 280); player.pause(); return false; }
      await resume(); return true;
    },
    state() { return { enabled, gestureReceived, filmActive, unavailable, playing: !player.paused }; },
    destroy() { player.pause(); },
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `node --test tests/audio-manager.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交状态机**

```bash
git add src/audio-manager.js tests/audio-manager.test.mjs
git commit -m "feat: manage persistent background music"
```

### Task 3: 添加常驻音乐按钮并连接路由

**Files:**
- Modify: `index.html`
- Modify: `script.js`
- Modify: `style.css`
- Modify: `tests/intro-film-ui.test.mjs`

- [ ] **Step 1: 写失败的壳层与路由集成断言**

在 `tests/intro-film-ui.test.mjs` 的壳层测试中追加：

```js
assert.match(documentHtml, /data-bgm-toggle/);
assert.match(documentHtml, /aria-pressed="true"/);
assert.match(script, /createAudioManager/);
assert.match(script, /startFromGesture/);
assert.match(script, /enterFilm/);
assert.match(script, /leaveFilm/);
assert.match(css, /\.bgm-toggle/);
```

- [ ] **Step 2: 运行并确认断言失败**

Run: `node --test tests/intro-film-ui.test.mjs`
Expected: FAIL，缺少 `data-bgm-toggle`。

- [ ] **Step 3: 在 `index.html` 添加常驻按钮**

紧接 `</main>` 前后保持按钮位于 `#app` 外：

```html
<button class="bgm-toggle" type="button" data-bgm-toggle aria-pressed="true" aria-label="关闭背景音乐">
  <span aria-hidden="true">♫</span><b>音乐</b>
</button>
```

- [ ] **Step 4: 在 `script.js` 连接按钮、首次手势和路由**

导入 `createAudioManager`，创建单例；用 `{ once: true, capture: true }` 监听首次 `pointerdown`/`keydown`；按钮点击调用 `toggle()` 并同步 `aria-pressed`。在 `renderRoute()` 开头按 `route.name === 'film'` 调用 `enterFilm()`，其余路由调用 `leaveFilm()`，并用 token 防止过期淡入覆盖新状态。

```js
import { createAudioManager } from './src/audio-manager.js';
const bgm = createAudioManager();
const bgmButton = document.querySelector('[data-bgm-toggle]');
const syncBgmButton = () => {
  const { enabled, unavailable } = bgm.state();
  bgmButton.setAttribute('aria-pressed', String(enabled));
  bgmButton.disabled = unavailable;
  bgmButton.setAttribute('aria-label', unavailable ? '背景音乐暂不可用' : enabled ? '关闭背景音乐' : '开启背景音乐');
};
document.addEventListener('pointerdown', () => bgm.startFromGesture().catch(() => {}), { once: true, capture: true });
document.addEventListener('keydown', () => bgm.startFromGesture().catch(() => {}), { once: true, capture: true });
bgmButton.addEventListener('click', async () => { await bgm.toggle(); syncBgmButton(); });
```

- [ ] **Step 5: 添加样式并运行测试**

在 `style.css` 添加固定圆角按钮、焦点样式、影片页中仍可见但不抢画面的状态，以及移动端安全区定位。

Run: `node --test tests/intro-film-ui.test.mjs tests/audio-manager.test.mjs`
Expected: PASS。

- [ ] **Step 6: 提交壳层集成**

```bash
git add index.html script.js style.css tests/intro-film-ui.test.mjs
git commit -m "feat: add global music control"
```

### Task 4: 实现影片退出按钮与 Esc

**Files:**
- Modify: `src/views.js`
- Modify: `src/after-film.js`
- Modify: `script.js`
- Modify: `style.css`
- Modify: `tests/after-film.test.mjs`
- Modify: `tests/intro-film-ui.test.mjs`

- [ ] **Step 1: 写点击与键盘退出的失败测试**

在 `tests/after-film.test.mjs` 导入 `bindFilmExit`，用 fake video 和 fake document 验证：点击 `[data-exit-film]` 以及 `Escape` 都会 `pause()` 一次并只导航到 `#after`；cleanup 后事件无效。

```js
test('退出影片会立即暂停并进入片后选择，cleanup 后不再响应', () => {
  const video = fakeVideo(); video.pauseCalls = 0; video.pause = () => { video.pauseCalls += 1; };
  const exit = { listener: null, addEventListener(_, fn) { this.listener = fn; }, removeEventListener() { this.listener = null; } };
  const keys = new Map();
  const documentRef = { addEventListener: (type, fn) => keys.set(type, fn), removeEventListener: (type) => keys.delete(type) };
  const destinations = [];
  const cleanup = bindFilmExit({ querySelector: (selector) => selector === '.film-video' ? video : exit }, {
    documentRef, navigate: (href) => destinations.push(href),
  });
  exit.listener({ preventDefault() {} });
  assert.equal(video.pauseCalls, 1);
  assert.deepEqual(destinations, ['#after']);
  cleanup();
  keys.get('keydown')?.({ key: 'Escape', preventDefault() {} });
  assert.deepEqual(destinations, ['#after']);
});
```

- [ ] **Step 2: 运行并确认 `bindFilmExit` 不存在**

Run: `node --test tests/after-film.test.mjs`
Expected: FAIL，缺少导出。

- [ ] **Step 3: 实现退出控制器和视图标记**

在 `src/views.js` 将 `.film-back` 改为：

```html
<a href="#after" class="film-exit" data-exit-film><span aria-hidden="true">×</span> 退出影片</a>
```

在 `src/after-film.js` 添加：

```js
export function bindFilmExit(root, { documentRef = document, navigate = (href) => { location.hash = href; } } = {}) {
  const video = root?.querySelector?.('.film-video');
  const button = root?.querySelector?.('[data-exit-film]');
  if (!video || !button) return () => {};
  let active = true;
  const exit = (event) => {
    if (!active) return;
    event?.preventDefault?.();
    video.pause();
    navigate('#after');
  };
  const keydown = (event) => { if (event.key === 'Escape') exit(event); };
  button.addEventListener('click', exit);
  documentRef.addEventListener('keydown', keydown);
  return () => {
    active = false;
    button.removeEventListener('click', exit);
    documentRef.removeEventListener('keydown', keydown);
  };
}
```

- [ ] **Step 4: 在 `script.js` 合并退出与结束 cleanup**

影片路由中同时绑定 `bindFilmCompletion()` 与 `bindFilmExit()`，`currentViewCleanup` 顺序调用两者；退出导航使用 `window.location.hash = '#after'`。退出后正常路由渲染会调用 BGM `leaveFilm()`。

- [ ] **Step 5: 添加始终可见的退出样式并运行测试**

`.film-exit` 固定在右上安全区，`z-index` 高于原生视频控件与错误状态；短屏和手机仍至少 44×44px。

Run: `node --test tests/after-film.test.mjs tests/intro-film-ui.test.mjs tests/audio-manager.test.mjs`
Expected: PASS。

- [ ] **Step 6: 提交影片退出**

```bash
git add src/views.js src/after-film.js script.js style.css tests/after-film.test.mjs tests/intro-film-ui.test.mjs
git commit -m "feat: let viewers exit the full film"
```

### Task 5: 完整回归与真实浏览器验收

**Files:**
- Modify: `tests/responsive-layout.test.mjs`（若截图/尺寸断言需要覆盖新按钮）

- [ ] **Step 1: 运行全部自动化测试**

Run: `npm test`
Expected: 全部 PASS，无未处理 Promise rejection。

- [ ] **Step 2: 重建数据并确认音视频资产未被改写**

Run: `npm run build:data`
Expected: 72 cases、138 occurrences、137 unique images；复盘媒体签名不变。
Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 3: 桌面与手机手工验收**

在桌面和手机尺寸验证：首次点击后低音量 BGM；刷新保留开关；进影片淡出；按钮和 `Esc` 立即退出到片后；退出后 BGM 恢复；影片加载失败仍能退出；按钮无溢出。

- [ ] **Step 4: 提交验收修正**

```bash
git add style.css tests/responsive-layout.test.mjs
git commit -m "test: verify audio and film exit flows"
```
