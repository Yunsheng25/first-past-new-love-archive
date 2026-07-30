# Progressive Media Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing GitHub Pages site reveal its usable homepage without waiting for large media, while loading film, BGM, review media, and archive images only when the visitor needs them.

**Architecture:** Remove the manifest-driven blocking and whole-site background fetches from the application boot path. Keep the existing loader as a short visual transition, then rely on native video metadata loading, lazy media markup, and the archive tunnel’s existing visible-window activation. Add explicit readiness styling for the intro film and delay creation of the BGM source until playback is actually requested.

**Tech Stack:** Static HTML/CSS, browser ES modules, native media elements, Node.js test runner, existing preview server and GitHub Pages workflow

---

## File Map

- Modify `script.js`: reveal the current route immediately and remove every manifest-wide preload call.
- Modify `src/views.js`: mark the intro background as metadata-only and readiness-driven.
- Modify `src/media-ui.js`: add and remove the intro film readiness class from real media events.
- Modify `style.css`: display the approved dark backdrop immediately and fade the film to its approved 64% opacity only when ready.
- Modify `src/audio-manager.js`: create the default audio element without a source and assign the BGM source immediately before the first real play request.
- Modify `tests/preloader-boot.test.mjs`: prove boot never imports or invokes the 486.6 MiB manifest loader.
- Modify `tests/intro-film-ui.test.mjs`: prove intro media is non-blocking and becomes ready from media events.
- Modify `tests/audio-manager.test.mjs`: prove the default BGM URL is absent before user intent and assigned before playback.
- Create `tests/progressive-loading.test.mjs`: lock the route media policy across film, review, archive, and boot.
- Modify `README.md`: document the new progressive loading behavior and verification commands.

### Task 1: Reveal the Application Shell Without Network Gating

**Files:**
- Modify: `tests/preloader-boot.test.mjs`
- Modify: `script.js`

- [ ] **Step 1: Replace the old blocking assertions with a failing boot-policy test**

```js
test('application reveals the current route without manifest-wide network gates', () => {
  assert.doesNotMatch(script, /PRELOAD_ASSETS/);
  assert.doesNotMatch(script, /preloadAssets|preloadInBackground|selectCriticalAssets/);
  assert.doesNotMatch(script, /runFullSitePreload/);
  assert.match(script, /assets:\s*\[\]/);

  const boot = script.match(/async function bootSite\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(boot, /await revealSite\(\)/);
  assert.doesNotMatch(boot, /fetch|preload/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/preloader-boot.test.mjs
```

Expected: FAIL because `script.js` still imports `PRELOAD_ASSETS`, calls `runFullSitePreload`, and starts `preloadInBackground`.

- [ ] **Step 3: Remove network work from the boot path**

Delete these imports from `script.js`:

```js
import { PRELOAD_ASSETS } from './preload-manifest.js';
import {
  preloadAssets,
  preloadInBackground,
  selectCriticalAssets,
} from './src/site-preloader.js';
```

Initialize the visual loader with no network inventory:

```js
const preloaderUI = mountPreloaderUI(document, {
  assets: [],
  onRetry: () => void bootSite(),
  onSkip: () => void revealSite(),
});
```

Delete `preloadAttempt`, `runFullSitePreload`, the `criticalPaths` calculation, and the `preloadInBackground` call. Make boot depend only on rendering:

```js
async function revealSite() {
  if (siteReady) return;
  siteReady = true;
  reviewTurnController.renderInitial(currentRoute());
  await preloaderUI.dismiss();
  preloaderUI.destroy();
}

async function bootSite() {
  if (siteReady) return;
  try {
    await revealSite();
  } catch (error) {
    preloaderUI.fail(error);
  }
}
```

- [ ] **Step 4: Verify GREEN**

```powershell
node --test tests/preloader-boot.test.mjs
```

Expected: all boot tests pass.

- [ ] **Step 5: Commit**

```powershell
git add script.js tests/preloader-boot.test.mjs
git commit -m "perf: reveal site without asset-wide preload"
```

### Task 2: Fade the Intro Film In After It Is Ready

**Files:**
- Modify: `tests/intro-film-ui.test.mjs`
- Modify: `src/views.js`
- Modify: `src/media-ui.js`
- Modify: `style.css`

- [ ] **Step 1: Add failing markup and readiness tests**

Add to the intro markup test:

```js
assert.match(html, /preload="metadata"/);
assert.match(html, /data-intro-film-ready="false"/);
```

Extend the fake video in the media binding test with:

```js
introVideo.dataset = { introFilmReady: 'false' };
introVideo.readyState = 0;
```

Then assert:

```js
introVideo.dispatch('loadeddata');
assert.equal(introVideo.dataset.introFilmReady, 'true');
introVideo.dispatch('error');
assert.equal(introVideo.dataset.introFilmReady, 'false');
```

Add a style assertion:

```js
assert.match(styles, /\.intro-film\[data-intro-film-ready="false"\][\s\S]*?opacity:\s*0/);
assert.match(styles, /\.intro-film\[data-intro-film-ready="true"\][\s\S]*?opacity:\s*0\.64/);
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/intro-film-ui.test.mjs
```

Expected: FAIL because the view still uses `preload="auto"` and no readiness state exists.

- [ ] **Step 3: Implement metadata-only readiness**

Change the intro video markup:

```html
preload="metadata"
data-intro-film-ready="false"
```

In `bindIntroMedia`, add:

```js
const showReady = () => {
  video.dataset.introFilmReady = 'true';
  clearMediaStatus(status);
};
const hideFilm = () => {
  video.dataset.introFilmReady = 'false';
};

video.addEventListener('loadeddata', showReady);
video.addEventListener('playing', showReady);
video.addEventListener('error', () => {
  hideFilm();
  showLoadFailure();
});
if (video.readyState >= 2) showReady();
```

Replace the intro film opacity rule with:

```css
.intro-film {
  opacity: 0;
  transition: opacity 900ms cubic-bezier(.22, .61, .36, 1);
}

.intro-film[data-intro-film-ready="true"] {
  opacity: 0.64;
}
```

Keep the existing saturation, contrast, positioning, and shade rules unchanged.

- [ ] **Step 4: Verify GREEN and reduced-motion behavior**

```powershell
node --test tests/intro-film-ui.test.mjs tests/responsive-smoke.test.mjs
```

Expected: both suites pass; reduced motion still pauses the background.

- [ ] **Step 5: Commit**

```powershell
git add src/views.js src/media-ui.js style.css tests/intro-film-ui.test.mjs
git commit -m "perf: reveal intro before background film"
```

### Task 3: Defer the BGM Request Until Playback Intent

**Files:**
- Modify: `tests/audio-manager.test.mjs`
- Modify: `src/audio-manager.js`

- [ ] **Step 1: Write a failing lazy-source test**

```js
test('default BGM source is assigned only when enabled playback is requested', async () => {
  const originalAudio = globalThis.Audio;
  const instances = [];
  try {
    globalThis.Audio = class FakeAudio {
      constructor() {
        this.src = '';
        this.preload = 'auto';
        this.paused = true;
        this.volume = 1;
        instances.push(this);
      }
      play() {
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    };
    const manager = createAudioManager({
      storage: createFakeStorage({ [BGM_PREFERENCE_KEY]: 'true' }),
      fade: immediateFade(instances[0]),
    });
    assert.equal(instances[0].src, '');
    assert.equal(instances[0].preload, 'none');
    await manager.startFromGesture();
    assert.equal(instances[0].src, BGM_SOURCE);
    manager.destroy();
  } finally {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/audio-manager.test.mjs
```

Expected: FAIL because `new Audio(BGM_SOURCE)` assigns the 6.3 MiB source during initial script evaluation.

- [ ] **Step 3: Implement lazy source assignment**

Create the default player without a URL:

```js
const ownsPlayer = !audio && typeof Audio === 'function';
const player = audio ?? (ownsPlayer ? new Audio() : null);
```

Configure it without fetching:

```js
if (player) {
  if (ownsPlayer) player.preload = 'none';
  player.loop = true;
  player.volume = 0;
}

const ensureSource = () => {
  if (ownsPlayer && !player.src) player.src = BGM_SOURCE;
};
```

Call `ensureSource()` immediately before `player.play()` inside `resume()`.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test tests/audio-manager.test.mjs tests/bgm-ui.test.mjs
```

Expected: all BGM state, fade, cancellation, and lazy-source tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/audio-manager.js tests/audio-manager.test.mjs
git commit -m "perf: load BGM only after playback intent"
```

### Task 4: Lock the Route-Level Media Policy

**Files:**
- Create: `tests/progressive-loading.test.mjs`
- Modify: `src/views.js`
- Modify: `src/review-reader.js` only if a test exposes an eager media attribute
- Modify: `src/archive-case-modal.js` only if a test exposes an eager media attribute

- [ ] **Step 1: Add the cross-route policy test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildFilmView, buildIntroView } from '../src/views.js';
import { buildReviewPage } from '../src/review-reader.js';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const tunnel = await readFile(new URL('../src/archive-tunnel.js', import.meta.url), 'utf8');

test('large route media is never part of application boot', () => {
  assert.doesNotMatch(script, /preload-manifest|PRELOAD_ASSETS|preloadInBackground/);
  assert.doesNotMatch(script, /full-film\.mp4|review-media|canvas-images/);
});

test('film and intro use native non-blocking media loading', () => {
  assert.match(buildIntroView(), /preload="metadata"/);
  assert.match(buildFilmView(), /preload="metadata"/);
});

test('archive tunnel assigns image sources only inside its visible activation window', () => {
  assert.match(tunnel, /function activateImage/);
  assert.match(tunnel, /entry\.image\.src = entry\.occurrence\.src/);
  assert.match(tunnel, /approvedTunnelVisibleRange/);
});
```

Use the smallest fixture accepted by `buildReviewPage` and assert every review `<img>` has `loading="lazy" decoding="async"` and every review `<video>` has `preload="metadata"`.

- [ ] **Step 2: Run the policy test**

```powershell
node --test tests/progressive-loading.test.mjs
```

Expected: PASS if existing review and archive policies are already lazy; otherwise FAIL only on the exact eager attribute found.

- [ ] **Step 3: Make only test-proven attribute corrections**

If the review assertion fails, use:

```html
<img ... loading="lazy" decoding="async">
<video ... preload="metadata" playsinline>
```

If the archive modal assertion fails, use:

```html
<img ... loading="lazy" decoding="async">
```

Do not change case order, image roles, modal grouping, tunnel projection, or mind-map branching.

- [ ] **Step 4: Run focused route suites**

```powershell
node --test tests/progressive-loading.test.mjs tests/review-reader.test.mjs tests/archive-ui.test.mjs tests/archive-tunnel-renderer.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add tests/progressive-loading.test.mjs src/review-reader.js src/archive-case-modal.js
git commit -m "test: lock progressive route media policy"
```

### Task 5: Verify Under the Real Preview Server

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all tests except the known stale Jianying FFmpeg fixture suite**

```powershell
$tests = Get-ChildItem tests -Filter '*.test.mjs' |
  Where-Object { $_.Name -ne 'video-assets.test.mjs' } |
  ForEach-Object { $_.FullName }
node --test $tests
```

Expected: zero failures. Record the existing `video-assets.test.mjs` exclusion as an environment-only issue caused by the removed Jianying FFmpeg path.

- [ ] **Step 2: Start the preview server**

```powershell
npm.cmd run preview
```

Expected: a localhost URL and no startup error.

- [ ] **Step 3: Inspect initial requests with a clean browser profile**

Open `/` and verify before any click:

- `index.html`, CSS, modules, and the intro video may be requested;
- the visible homepage appears before the intro video completes;
- `full-film.mp4`, the BGM MP3, review media, and canvas images are not requested;
- no manifest-driven stream continues downloading hundreds of megabytes.

- [ ] **Step 4: Verify each intent path**

1. Enable BGM: the MP3 request begins only then.
2. Click the film: `full-film.mp4` begins only then; exit, seeking, and fullscreen work.
3. Enter review: `review.json` and visible page media load; distant pages do not all download.
4. Enter archive: `archive.json` loads and only tunnel-visible images receive sources.

- [ ] **Step 5: Document and commit**

Add to `README.md`:

```markdown
## Loading model

The site reveals its application shell before large media is ready. Background film,
BGM, full film, review media, and archive images load progressively from visitor intent
and the current visible window; the application must not preload the full media archive.
```

Then:

```powershell
git add README.md
git commit -m "docs: record progressive loading model"
```

### Task 6: Publish and Compare Production

**Files:**
- No new source files

- [ ] **Step 1: Run final verification**

```powershell
git diff --check
git status --short
$tests = Get-ChildItem tests -Filter '*.test.mjs' |
  Where-Object { $_.Name -ne 'video-assets.test.mjs' } |
  ForEach-Object { $_.FullName }
node --test $tests
```

Expected: zero failures and only intended files committed.

- [ ] **Step 2: Merge the verified branch into local master**

Use the finishing-a-development-branch workflow. Preserve all unrelated untracked files in the main workspace.

- [ ] **Step 3: Push local master to GitHub Pages production**

```powershell
git push origin master:main
```

Expected: the Pages workflow succeeds.

- [ ] **Step 4: Compare live response behavior**

Open:

```text
https://yunsheng25.github.io/first-past-new-love-archive/
```

Expected:

- the loader leaves in about one second rather than waiting roughly 25 seconds;
- no 486.6 MiB whole-site background transfer starts;
- visual appearance remains consistent as the intro video fades in;
- BGM and film begin only from visitor intent;
- review and archive media remain complete and correctly ordered.
