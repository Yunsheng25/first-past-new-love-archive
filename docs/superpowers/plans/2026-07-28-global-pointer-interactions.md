# Global Pointer Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add broad-radius character magnetism, a uniform numbered review directory, and a high-density cursor-attracted particle field to every non-film route.

**Architecture:** Keep the three behaviors independent. `text-motion.js` owns character proximity calculations, `review-reader.js` owns chapter-directory markup, and a new `global-particles.js` owns one route-scoped canvas with its animation lifecycle; `script.js` composes their cleanup functions at route boundaries.

**Tech Stack:** Vanilla JavaScript ES modules, Canvas 2D, CSS custom properties, Node.js built-in test runner.

---

### Task 1: Implement broad-radius character magnetism

**Files:**
- Modify: `src/text-motion.js`
- Modify: `style.css`
- Modify: `tests/text-motion.test.mjs`

- [ ] **Step 1: Write failing proximity and cleanup tests**

Add tests for a pure response helper and the mounted listener:

```js
import {
  characterMagnetism,
  mountCharacterMotion,
  splitTextCharacters,
} from '../src/text-motion.js';

test('character magnetism responds before the pointer touches the glyph', () => {
  const response = characterMagnetism({ x: 100, y: 100 }, { x: 220, y: 100 }, 180);
  assert.ok(response.power > 0);
  assert.ok(response.lift < 0);
  assert.ok(response.scale > 1);
  assert.equal(characterMagnetism({ x: 100, y: 100 }, { x: 281, y: 100 }, 180).power, 0);
});

test('mounted character motion listens on the whole root and cleanup restores characters', () => {
  const fixture = characterMotionFixture();
  const cleanup = mountCharacterMotion(fixture.root);
  assert.equal(fixture.root.listeners.has('pointermove'), true);
  fixture.root.listeners.get('pointermove')({ clientX: 120, clientY: 100 });
  assert.notEqual(fixture.characters[0].style.getPropertyValue('--motion-lift'), '');
  cleanup();
  assert.equal(fixture.root.listeners.has('pointermove'), false);
  assert.equal(fixture.characters[0].style.getPropertyValue('--motion-lift'), '');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/text-motion.test.mjs`

Expected: FAIL because `characterMagnetism` does not exist and `mountCharacterMotion()` does not return cleanup.

- [ ] **Step 3: Add the pure magnetic response**

Implement:

```js
export function characterMagnetism(character, pointer, reach = 180) {
  const distance = Math.hypot(character.x - pointer.x, character.y - pointer.y);
  if (distance >= reach) return { power: 0, lift: 0, scale: 1, glow: 0 };
  const power = 1 - distance / reach;
  return {
    power,
    lift: -13 * power,
    scale: 1 + 0.08 * power,
    glow: 0.55 * power,
  };
}
```

- [ ] **Step 4: Mount one root-level pointer listener**

After splitting text into `.motion-character` spans:

```js
const characters = [...root.querySelectorAll('.motion-character')];
const reset = () => characters.forEach((character) => {
  character.style.removeProperty('--motion-lift');
  character.style.removeProperty('--motion-scale');
  character.style.removeProperty('--motion-glow');
});
const move = (event) => characters.forEach((character) => {
  const bounds = character.getBoundingClientRect();
  const response = characterMagnetism(
    { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
    { x: event.clientX, y: event.clientY },
  );
  character.style.setProperty('--motion-lift', `${response.lift}px`);
  character.style.setProperty('--motion-scale', response.scale);
  character.style.setProperty('--motion-glow', response.glow);
});
root.addEventListener('pointermove', move, { passive: true });
root.addEventListener('pointerleave', reset, { passive: true });
return () => {
  root.removeEventListener('pointermove', move);
  root.removeEventListener('pointerleave', reset);
  reset();
};
```

The function must return `() => {}` without listeners for coarse pointers or reduced motion.

- [ ] **Step 5: Replace exact glyph hover CSS**

Style the characters from their properties:

```css
.motion-character {
  display: inline-block;
  transform: translateY(var(--motion-lift, 0))
    scale(var(--motion-scale, 1));
  text-shadow: 0 .45rem 2rem
    rgba(217, 158, 72, var(--motion-glow, 0));
  transition: transform .2s cubic-bezier(.16, 1, .3, 1),
    color .2s ease,
    text-shadow .2s ease;
}
```

Remove the old rule that requires `.motion-character:hover`.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `node --test tests/text-motion.test.mjs`

Expected: all text-motion tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/text-motion.js style.css tests/text-motion.test.mjs
git commit -m "feat: broaden character motion response"
```

### Task 2: Replace mixed chapter previews with a numbered directory

**Files:**
- Modify: `src/review-reader.js`
- Modify: `style.css`
- Modify: `tests/review-reader-ui.test.mjs`

- [ ] **Step 1: Replace the preview test with a failing numbered-directory test**

```js
test('review index uses one numbered directory rule without chapter previews', () => {
  const html = buildReviewIndex(reviewData, null);
  const numbers = [...html.matchAll(/class="review-index-number">(\d{2})</g)]
    .map((match) => match[1]);
  assert.deepEqual(numbers, ['01', '02', '03', '04', '05']);
  assert.doesNotMatch(html, /review-index-preview/);
  assert.doesNotMatch(html, /data-chapter-preview|data-chapter-placeholder/);
  assert.doesNotMatch(html, /<img\b[^>]*loading="lazy"/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/review-reader-ui.test.mjs`

Expected: FAIL because `chapterPreview()` still emits images and placeholders.

- [ ] **Step 3: Remove preview generation from the index**

Delete `chapterPreview()`. Render every row as:

```html
<a class="review-index-card" href="...">
  <span class="review-index-number">01</span>
  <span class="review-index-card-copy">...</span>
  <small data-reading-time="...">...</small>
</a>
```

Do not change chapter ordering, `pageHref()`, continuation links, title, summary, reading time, or page count.

- [ ] **Step 4: Convert the list CSS to the D layout**

Use:

```css
.review-index-card {
  grid-template-columns: clamp(58px, 6vw, 82px) minmax(0, 1fr) auto;
}

.review-index-number {
  color: #a45f53;
  font: 300 clamp(26px, 3vw, 42px)/1 Georgia, serif;
  letter-spacing: .03em;
}
```

Remove `.review-index-preview`, `.review-index-preview img`, `.review-index-placeholder`, and their mobile overrides.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/review-reader-ui.test.mjs`

Expected: all review-reader UI tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/review-reader.js style.css tests/review-reader-ui.test.mjs
git commit -m "refactor: unify review chapter directory"
```

### Task 3: Build the high-density particle attraction module

**Files:**
- Create: `src/global-particles.js`
- Create: `tests/global-particles.test.mjs`
- Modify: `style.css`

- [ ] **Step 1: Write failing pure-function tests**

```js
import {
  particleCountForViewport,
  particleAttraction,
} from '../src/global-particles.js';

test('particle density scales with area and stays capped', () => {
  assert.equal(particleCountForViewport(1440, 900), 320);
  assert.ok(particleCountForViewport(800, 600) < 320);
  assert.equal(particleCountForViewport(8000, 4000), 320);
});

test('particles inside 310px attract and orbit while distant particles return home', () => {
  const near = particleAttraction(
    { x: 100, y: 100, originX: 20, originY: 20 },
    { x: 220, y: 100 },
    true,
  );
  assert.ok(near.accelerationX > 0);
  assert.notEqual(near.accelerationY, 0);
  const far = particleAttraction(
    { x: 100, y: 100, originX: 20, originY: 20 },
    { x: 800, y: 800 },
    false,
  );
  assert.ok(far.accelerationX < 0);
  assert.ok(far.accelerationY < 0);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/global-particles.test.mjs`

Expected: FAIL because `src/global-particles.js` does not exist.

- [ ] **Step 3: Implement density and attraction math**

```js
export function particleCountForViewport(width, height) {
  const area = Math.max(0, width) * Math.max(0, height);
  return Math.min(320, Math.max(48, Math.floor(area / 3800)));
}

export function particleAttraction(particle, pointer, active, reach = 310) {
  const dx = pointer.x - particle.x;
  const dy = pointer.y - particle.y;
  const distance = Math.hypot(dx, dy) || 1;
  if (!active || distance >= reach) {
    return {
      accelerationX: (particle.originX - particle.x) * 0.00045,
      accelerationY: (particle.originY - particle.y) * 0.00045,
      proximity: 0,
    };
  }
  const proximity = 1 - distance / reach;
  const pull = 0.13 * proximity * proximity;
  const orbit = distance < 125 ? 0.085 * (1 - distance / 125) : 0;
  return {
    accelerationX: dx / distance * pull - dy / distance * orbit,
    accelerationY: dy / distance * pull + dx / distance * orbit,
    proximity,
  };
}
```

- [ ] **Step 4: Write a failing lifecycle test**

Build a small fake document, window, root, canvas context, observer, and animation-frame queue. Assert:

```js
const cleanup = mountGlobalParticles(root, fixtureOptions);
assert.equal(root.querySelector('.app-view').firstChild.className, 'global-particle-field');
assert.equal(root.listeners.has('pointermove'), true);
assert.equal(document.listeners.has('visibilitychange'), true);
cleanup();
assert.equal(canvas.removed, true);
assert.equal(root.listeners.has('pointermove'), false);
assert.equal(document.listeners.has('visibilitychange'), false);
assert.equal(cancelledFrames.includes(frameId), true);
```

Add a second test proving coarse pointer and reduced motion return a no-op without creating canvas.

- [ ] **Step 5: Implement `mountGlobalParticles()`**

The exported function must:

- accept injected `windowRef`, `documentRef`, `matchMedia`, `requestFrame`, `cancelFrame`, and `createObserver` for testability;
- return a no-op for coarse pointer or reduced motion;
- create one `canvas.global-particle-field`, mark it `aria-hidden="true"`, and prepend it to the current `.app-view`;
- observe `root` so delayed review rendering or view replacement reattaches the canvas;
- cap DPR at 2 and seed `particleCountForViewport(width, height)` particles;
- track root pointer movement, deactivate after 1.5 seconds, and use `particleAttraction()` each frame;
- pause when `document.visibilityState === 'hidden'`;
- remove all pointer, resize, visibility listeners, observer, canvas, and animation frame on cleanup.

- [ ] **Step 6: Add the canvas presentation**

```css
.app-view {
  isolation: isolate;
}

.global-particle-field {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.review-reader-view .global-particle-field {
  opacity: .75;
}
```

Because the canvas is prepended as the first child, later route content paints above it. Existing route controls retain their current z-index.

- [ ] **Step 7: Run the module tests and verify GREEN**

Run: `node --test tests/global-particles.test.mjs`

Expected: all particle tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/global-particles.js style.css tests/global-particles.test.mjs
git commit -m "feat: add global particle attraction field"
```

### Task 4: Compose interactions at every non-film route

**Files:**
- Modify: `script.js`
- Modify: `tests/after-cursor.test.mjs`
- Modify: `tests/preloader-boot.test.mjs`

- [ ] **Step 1: Write the failing route-composition test**

Add assertions:

```js
assert.match(source, /import \{ mountGlobalParticles \} from '.\/src\/global-particles\.js';/);
assert.match(source, /function mountRouteInteractions/);
for (const route of ['intro', 'after', 'review-index', 'review-page', 'archive-index', 'archive-detail']) {
  assert.match(source, new RegExp(`route\\.name === '${route}'|'${route}'`));
}
const filmBlock = source.match(/if \(route\.name === 'film'\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
assert.doesNotMatch(filmBlock, /mountGlobalParticles|mountRouteInteractions/);
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `node --test tests/after-cursor.test.mjs tests/preloader-boot.test.mjs`

Expected: FAIL because the global particle module is not imported or composed.

- [ ] **Step 3: Add one route interaction composer**

```js
function mountRouteInteractions(...cleanups) {
  const particleCleanup = mountGlobalParticles(app);
  const cursorCleanup = mountAfterCursor(app, { cursor: sharedCursor });
  return () => {
    particleCleanup();
    cursorCleanup();
    cleanups.reverse().forEach((cleanup) => cleanup?.());
  };
}
```

Use it on intro, after, review index/page, archive index/detail, and pending views. Pass the cleanup returned by `mountCharacterMotion()` for intro, after, and pending. Preserve review, archive, and mind-map cleanup functions as additional arguments.

Do not call it in the film route.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `node --test tests/after-cursor.test.mjs tests/preloader-boot.test.mjs`

Expected: all route-composition tests pass.

- [ ] **Step 5: Commit**

```bash
git add script.js tests/after-cursor.test.mjs tests/preloader-boot.test.mjs
git commit -m "feat: mount interactions across non-film routes"
```

### Task 5: Verify the complete site and publish

**Files:**
- Verify: `src/text-motion.js`
- Verify: `src/review-reader.js`
- Verify: `src/global-particles.js`
- Verify: `script.js`
- Verify: `style.css`

- [ ] **Step 1: Run the complete automated suite**

Run: `npm.cmd test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check`

Expected: exit code 0 and no output.

- [ ] **Step 3: Perform desktop visual verification**

Check the local website at 1440×900:

1. homepage characters respond before the cursor touches them;
2. review index shows only 01—05 and no chapter image;
3. particles visibly attract and orbit on intro, after, review index, review page, archive index, and archive detail;
4. review reading particles are visibly dimmer;
5. links, scroll, canvas drag, modal controls, and the circular cursor remain usable;
6. film playback has no particle canvas.

- [ ] **Step 4: Verify fallbacks**

Check reduced motion and a coarse pointer viewport: no magnetic characters or particle canvas is created, while content and native pointer behavior remain intact.

- [ ] **Step 5: Push the verified main branch**

Run: `git push origin master:main`

Expected: remote `main` advances to the verified feature commit.

- [ ] **Step 6: Verify GitHub Pages**

Wait for the deployment run to succeed, then confirm the public JS contains `mountGlobalParticles` and the public review index no longer emits `review-index-preview`.
