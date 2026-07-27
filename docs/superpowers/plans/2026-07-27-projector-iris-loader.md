# Projector Iris Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current moving film-strip loader with the approved projector-iris composition and glass-reveal cursor while preserving all preload behavior.

**Architecture:** Keep `site-preloader.js` and the boot flow unchanged. Change only the DOM contract produced by `preloader-ui.js`, its pointer coordinates, and the corresponding loader section of `style.css`; retain the current progress, retry, skip, and dismiss APIs.

**Tech Stack:** Vanilla JavaScript ES modules, CSS animations and masking, Node.js built-in test runner.

---

### Task 1: Lock the approved loader markup contract

**Files:**
- Modify: `tests/preloader-ui.test.mjs`
- Modify: `src/preloader-ui.js`

- [ ] **Step 1: Write the failing markup test**

Replace the old film-roll expectations with:

```js
test('preloader markup contains projector iris, glass reveal and real progress controls', () => {
  const markup = buildPreloaderMarkup([
    { path: 'assets/a.png', bytes: 1 },
    { path: 'assets/b.mp4', bytes: 2 },
  ]);
  assert.match(markup, /data-preload-iris/);
  assert.match(markup, /preload-lens-reveal/);
  assert.match(markup, /preload-lens/);
  assert.match(markup, /data-preload-percent/);
  assert.match(markup, /data-preload-bytes/);
  assert.match(markup, /data-preload-files/);
  assert.match(markup, /data-preload-retry/);
  assert.match(markup, /data-preload-skip/);
  assert.doesNotMatch(markup, /data-preload-film/);
  assert.doesNotMatch(markup, /preload-card/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/preloader-ui.test.mjs`

Expected: FAIL because the current markup still contains `data-preload-film` and has no iris or lens.

- [ ] **Step 3: Replace film-strip markup with the iris layers**

In `buildPreloaderMarkup()`, remove the generated cards and return these visual layers before the existing center progress block:

```html
<div class="preload-grain" aria-hidden="true"></div>
<header class="preload-header" aria-hidden="true">
  <span>初恋 · 旧爱 · 新欢</span><span>A FILM ARCHIVE · 2026</span>
</header>
<div class="preload-iris-wrap" data-preload-iris aria-hidden="true">
  <i class="preload-iris-ring"></i>
  <i class="preload-iris-core"></i>
</div>
<div class="preload-lens-reveal" aria-hidden="true">初恋 · 旧爱 · 新欢</div>
<i class="preload-lens" aria-hidden="true"></i>
```

Keep `.preload-center`, all progress selectors, retry, skip, status, and metadata unchanged.

- [ ] **Step 4: Simplify pointer handling**

Remove card lookup, parallax properties, distance checks, and `developedCardCount()` usage from `mountPreloaderUI()`. Keep only:

```js
function pointerMove(event) {
  if (destroyed) return;
  root.style.setProperty('--preload-pointer-x', `${event.clientX}px`);
  root.style.setProperty('--preload-pointer-y', `${event.clientY}px`);
}
```

The `update()` function must continue updating percent, track, bytes, files, and phase.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/preloader-ui.test.mjs`

Expected: all preloader UI tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/preloader-ui.test.mjs src/preloader-ui.js
git commit -m "refactor: replace film loader markup with projector iris"
```

### Task 2: Implement the approved G plus K visual system

**Files:**
- Modify: `tests/preloader-ui.test.mjs`
- Modify: `style.css`

- [ ] **Step 1: Write the failing stylesheet contract**

Replace the old film/card stylesheet test with:

```js
test('formal stylesheet defines projector iris, glass reveal and reduced motion', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.preload-iris-wrap/);
  assert.match(css, /\.preload-iris-core/);
  assert.match(css, /\.preload-lens-reveal/);
  assert.match(css, /clip-path:\s*circle/);
  assert.match(css, /\.preload-lens/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*preload-iris/);
  assert.doesNotMatch(css, /\.preload-film\s*\{/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/preloader-ui.test.mjs`

Expected: FAIL because the formal stylesheet still defines the film strip and not the approved iris/lens classes.

- [ ] **Step 3: Replace the old visual CSS**

In the full-site preload section of `style.css`:

- keep `.site-is-preloading`, hidden app rules, `.site-preloader`, skeleton, grain, header, progress, actions, hint, leave transition, and mobile layout;
- remove `.preload-film`, `.preload-card`, `.preload-ripple`, `.preload-cursor`, their keyframes, and parallax variables;
- add `.preload-iris-wrap`, `.preload-iris-ring`, and `.preload-iris-core` for the centered warm projector lens;
- add `.preload-lens-reveal` with `clip-path: circle(0 at var(--preload-pointer-x) var(--preload-pointer-y))`;
- expand that clip to a 76px radius on pointer-capable devices;
- add `.preload-lens` as a transparent 152px circular glass border centered at the pointer coordinates;
- ensure `.preload-center` remains above the iris and does not block retry/skip buttons.

- [ ] **Step 4: Add accessibility fallbacks**

Under `@media (prefers-reduced-motion: reduce)`, set iris animations to `none`.

Under `@media (pointer: coarse)`, hide `.preload-lens` and `.preload-lens-reveal`, and restore `cursor: auto` on `.site-preloader`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/preloader-ui.test.mjs tests/preloader-boot.test.mjs tests/site-preloader.test.mjs`

Expected: all focused loader tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/preloader-ui.test.mjs style.css
git commit -m "feat: style projector iris loader with glass reveal"
```

### Task 3: Verify the complete site and publish

**Files:**
- Verify: `index.html`
- Verify: `script.js`
- Verify: `src/preloader-ui.js`
- Verify: `style.css`

- [ ] **Step 1: Run the full automated suite**

Run: `npm.cmd test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check`

Expected: exit code 0 and no output.

- [ ] **Step 3: Preview desktop behavior**

Start the local preview and confirm:

1. the loader shows a centered breathing projector iris;
2. moving the mouse reveals the hidden title only inside the glass lens;
3. the lens does not obscure progress or buttons;
4. the site still reveals after critical assets finish;
5. retry and direct-entry remain available after a simulated failure.

- [ ] **Step 4: Preview reduced-motion and mobile fallbacks**

Confirm the iris becomes static with reduced motion and custom lens layers are hidden on a coarse pointer viewport.

- [ ] **Step 5: Push the verified branch**

```bash
git push origin master:main
```

- [ ] **Step 6: Verify GitHub Pages**

Confirm the deployment run for the pushed commit completes successfully and the public `style.css` contains `.preload-iris-wrap` and `.preload-lens-reveal`.
