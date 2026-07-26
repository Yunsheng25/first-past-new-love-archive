# After-Choice Splash Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive, project-colored fluid splash background to the after-film choice page without blocking links or wasting resources after navigation.

**Architecture:** A focused `after-splash.js` module owns WebGL setup, pointer input, animation, performance scaling, failure fallback, and cleanup. The existing view adds only a canvas mount point; `script.js` starts and disposes the effect through its existing per-route cleanup hook.

**Tech Stack:** Native JavaScript ES modules, WebGL, CSS, Node test runner.

---

### Task 1: Define the mount contract and lifecycle tests

**Files:**
- Create: `tests/after-splash.test.mjs`
- Modify: `src/views.js`

- [ ] **Step 1: Write failing tests for the canvas mount and reduced-motion fallback**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAfterView } from '../src/views.js';
import { mountAfterSplash } from '../src/after-splash.js';

test('after view exposes a non-interactive splash canvas', () => {
  const html = buildAfterView();
  assert.match(html, /<canvas class="after-splash" data-after-splash aria-hidden="true"><\/canvas>/);
});

test('reduced motion skips WebGL initialization', () => {
  let contexts = 0;
  const canvas = { getContext() { contexts += 1; } };
  const root = { querySelector: () => canvas };
  const cleanup = mountAfterSplash(root, { matchMedia: () => ({ matches: true }) });
  assert.equal(contexts, 0);
  assert.equal(typeof cleanup, 'function');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/after-splash.test.mjs`

Expected: FAIL because `src/after-splash.js` and the canvas mount do not exist.

- [ ] **Step 3: Add the canvas mount immediately after `.after-shade`**

```html
<canvas class="after-splash" data-after-splash aria-hidden="true"></canvas>
```

- [ ] **Step 4: Add a minimal exported mount function with reduced-motion guard**

```js
export function mountAfterSplash(
  root,
  { matchMedia = (query) => globalThis.matchMedia?.(query) } = {},
) {
  if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return () => {};
  const canvas = root?.querySelector?.('[data-after-splash]');
  if (!canvas) return () => {};
  return () => {};
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `node --test tests/after-splash.test.mjs`

Expected: PASS.

### Task 2: Implement the fluid simulation and deterministic cleanup

**Files:**
- Modify: `src/after-splash.js`
- Modify: `tests/after-splash.test.mjs`

- [ ] **Step 1: Add failing lifecycle tests**

```js
test('mount registers pointer input and cleanup removes it and cancels animation', () => {
  const listeners = new Map();
  let cancelled = null;
  const canvas = {
    width: 0, height: 0, clientWidth: 1080, clientHeight: 700,
    getContext: () => fakeWebGlContext(),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const cleanup = mountAfterSplash(
    { querySelector: () => canvas },
    {
      matchMedia: () => ({ matches: false }),
      requestFrame: () => 42,
      cancelFrame: (id) => { cancelled = id; },
      devicePixelRatio: 1,
    },
  );
  assert.equal(listeners.has('pointermove'), true);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(cancelled, 42);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/after-splash.test.mjs`

Expected: FAIL because the module does not yet own listeners or an animation frame.

- [ ] **Step 3: Implement the WebGL pipeline**

Implement shader compilation, two velocity framebuffers, two dye framebuffers, pressure solve, curl/vorticity, advection, splat injection, final display, resize handling, and the warm palette:

```js
const PALETTE = [
  [0.42, 0.075, 0.045],
  [0.58, 0.27, 0.105],
  [0.22, 0.145, 0.11],
];
const DESKTOP = { simResolution: 128, dyeResolution: 1024, densityDissipation: 3.5, velocityDissipation: 2, pressure: 0.1, curl: 3, splatRadius: 0.2, splatForce: 6000 };
const COMPACT = { ...DESKTOP, simResolution: 64, dyeResolution: 512, splatForce: 3600 };
```

Use `pointermove` deltas to inject velocity and cycle slowly through `PALETTE`. Clamp device pixel ratio to `1.5`, and use the compact preset below 820 CSS pixels.

- [ ] **Step 4: Make initialization failure-safe and cleanup idempotent**

Return a no-op cleanup when WebGL2/WebGL is unavailable or shader/framebuffer creation fails. Cleanup must remove pointer/resize listeners, cancel the current animation frame, and delete created programs, shaders, textures, and framebuffers once.

- [ ] **Step 5: Run the focused test and full unit suite**

Run: `node --test tests/after-splash.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

### Task 3: Integrate the effect into route rendering and visual layers

**Files:**
- Modify: `script.js`
- Modify: `style.css`
- Modify: `tests/after-splash.test.mjs`

- [ ] **Step 1: Add failing source-integration assertions**

```js
test('route entry mounts the splash and stores its cleanup', async () => {
  const source = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ mountAfterSplash \} from '.\/src\/after-splash\.js';/);
  assert.match(source, /currentViewCleanup = mountAfterSplash\(app\);/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/after-splash.test.mjs`

Expected: FAIL because route integration is absent.

- [ ] **Step 3: Mount the effect on the after route**

```js
import { mountAfterSplash } from './src/after-splash.js';
// ...
applyStoredLastFrame(app);
currentViewCleanup = mountAfterSplash(app);
focusRenderedView(app);
```

- [ ] **Step 4: Add visual layering and fallback CSS**

```css
.after-splash {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: .62;
  mix-blend-mode: screen;
}
.after-header,
.after-content { position: relative; z-index: 3; }
@media (prefers-reduced-motion: reduce) {
  .after-splash { display: none; }
}
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: all tests PASS.

### Task 4: Browser verification

**Files:**
- Verify: `index.html`
- Verify: `src/after-splash.js`
- Verify: `style.css`

- [ ] **Step 1: Start the existing local preview server**

Run: `python -m http.server 62389`

Expected: the site is available at `http://localhost:62389/`.

- [ ] **Step 2: Open `#after` and verify interaction**

Expected: the fluid follows broad pointer movement across the background, uses only dark red/warm gold/grey-brown, and both cards remain readable and clickable.

- [ ] **Step 3: Verify cleanup**

Navigate repeatedly between `#after`, `#review`, and `#archive`.

Expected: no animation continues after leaving `#after`, no console errors appear, and returning restarts the effect once.

- [ ] **Step 4: Verify fallback**

Enable reduced motion in browser emulation and reload `#after`.

Expected: the static background remains usable and no WebGL canvas animation starts.
