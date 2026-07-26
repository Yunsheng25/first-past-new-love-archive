# After-Choice Circle Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the after-film WebGL fluid splash with the previously approved expanding circular cursor.

**Architecture:** A small `after-cursor.js` module owns pointer tracking, hover state, animation, and cleanup. The after-film view supplies one decorative cursor element, while CSS controls its ring, center dot, expanded state, and subtle card movement.

**Tech Stack:** Native JavaScript ES modules, CSS, Node test runner.

---

### Task 1: Replace the splash contract with a cursor contract

**Files:**
- Delete: `src/after-splash.js`
- Delete: `tests/after-splash.test.mjs`
- Create: `src/after-cursor.js`
- Create: `tests/after-cursor.test.mjs`
- Modify: `src/views.js`

- [ ] Write a failing test that requires `<span class="after-cursor" data-after-cursor aria-hidden="true"></span>`, verifies reduced-motion uses direct positioning, and verifies cleanup removes pointer listeners and cancels its frame.
- [ ] Run `node --test tests/after-cursor.test.mjs`; expect failure because the cursor module and markup do not exist.
- [ ] Add the cursor markup and implement `mountAfterCursor(root, options)` with fine-pointer detection, `pointermove`, `pointerleave`, `pointerover`, `pointerout`, requestAnimationFrame smoothing, `is-over-choice`, and idempotent cleanup.
- [ ] Remove the splash canvas, module, and tests.
- [ ] Run `node --test tests/after-cursor.test.mjs`; expect all focused tests to pass.

### Task 2: Update route lifecycle and styles

**Files:**
- Modify: `script.js`
- Modify: `style.css`
- Test: `tests/after-cursor.test.mjs`

- [ ] Add source assertions requiring `mountAfterCursor` and rejecting all `mountAfterSplash` references.
- [ ] Run the focused test; expect failure before integration.
- [ ] Import `mountAfterCursor`, assign its cleanup on the after route, delete all `.after-splash` rules, and add the following cursor contract:

```css
@media (hover: hover) and (pointer: fine) {
  .after-view.cursor-ready { cursor: none; }
  .after-view.cursor-ready a { cursor: none; }
  .after-cursor {
    position: fixed;
    z-index: 20;
    width: 42px;
    height: 42px;
    border: 1px solid rgba(238, 231, 220, .82);
    border-radius: 50%;
    pointer-events: none;
    transform: translate3d(-50%, -50%, 0);
  }
  .after-cursor::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #eee7dc;
    transform: translate(-50%, -50%);
  }
  .after-cursor.is-over-choice {
    width: 76px;
    height: 76px;
    background: rgba(196, 132, 91, .08);
  }
  .after-choice.is-cursor-over {
    transform: translateX(8px) scale(1.015);
  }
}
```

- [ ] Run `npm test`; expect all tests to pass.
- [ ] Open `http://localhost:62389/#after`, verify the circle expands over both cards, links remain clickable, and no fluid remains.
