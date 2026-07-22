# Approved Tunnel Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected elliptical fly-by tunnel with the exact front-facing depth experience approved in preview version 15.

**Architecture:** Keep the public `mountArchiveTunnel()` controller contract and the deterministic cruise/rewind state machine, but replace pose/render geometry with the version-15 front-facing depth projection. Treat the saved preview as the visual oracle and preserve current lifecycle, cache, modal and fallback guarantees.

**Tech Stack:** Browser DOM/CSS transforms or Three.js front-facing planes, requestAnimationFrame, existing archive state machine, Node test runner, real Chrome acceptance.

---

### Task 1: Extract the approved projection as a pure model

**Files:**
- Modify: `src/archive-tunnel-data.js`
- Test: `tests/archive-tunnel.test.mjs`
- Reference: `.superpowers/brainstorm/1038-1784457763/content/archive-vertical-pair-card-v15-17.html`

- [ ] **Step 1: Add failing projection-signature tests**

Extract representative version-15 values at entrance, middle and deep positions. Assert cards stay front-facing, shrink monotonically toward the center, preserve a small gap, and the first/last visible bands match the approved preview.

```js
assert.equal(pose.rotationX, 0);
assert.equal(pose.rotationY, 0);
assert.ok(near.scale > middle.scale && middle.scale > deep.scale);
assert.ok(Math.hypot(deep.x, deep.y) < Math.hypot(near.x, near.y));
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/archive-tunnel.test.mjs`  
Expected: FAIL because current `tunnelPose()` returns the elliptical world path.

- [ ] **Step 3: Implement version-15 depth projection**

Create `approvedTunnelPose(index, camera)` using the exact angle, radial depth, scale and visibility equations copied from the saved preview. Return a frozen value:

```js
return Object.freeze({ x, y, scale, opacity, visible, zIndex });
```

Do not introduce a new aesthetic formula. Document each constant with the corresponding preview constant.

- [ ] **Step 4: Run projection tests and commit**

Run: `node --test tests/archive-tunnel.test.mjs`  
Expected: PASS.

```powershell
git add src/archive-tunnel-data.js tests/archive-tunnel.test.mjs
git commit -m "fix: restore the approved tunnel projection"
```

### Task 2: Render front-facing cards with the existing controller contract

**Files:**
- Modify: `src/archive-tunnel.js`
- Modify: `style.css`
- Test: `tests/archive-tunnel.test.mjs`

- [ ] **Step 1: Add failing renderer tests**

Assert all visible images face the viewer, use `opacity:1` on the image element, update transform/size from approved poses, select exact occurrences, and clean every listener/RAF/image reference on destroy. Assert no ellipse-tangent rotations or side fly-by camera transforms remain.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/archive-tunnel.test.mjs`.

- [ ] **Step 3: Replace only the visual renderer**

Keep controller methods `pause`, `resume`, `nudge`, `startRewind`, `snapshot`, `destroy`. Render ordered buttons inside the stage and apply the pure pose:

```js
card.style.transform = `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`;
card.style.opacity = pose.visible ? String(pose.opacity) : '0';
card.style.zIndex = String(pose.zIndex);
```

The `<img>` stays `opacity:1; filter:none`; any depth fading belongs to the card wrapper only.

- [ ] **Step 4: Restore version-15 background and spacing CSS**

Copy the approved near-black radial background, soft-light pseudo-element, card border/shadow, central mouth, navigation hierarchy, counter and progress line. Explicitly omit `repeating-conic-gradient`, ray animations and rotating decorative layers.

- [ ] **Step 5: Run renderer/lifecycle tests and commit**

Run: `node --test tests/archive-tunnel.test.mjs tests/archive-ui.test.mjs`  
Expected: PASS, including destroy/re-entry and progress restoration.

```powershell
git add src/archive-tunnel.js style.css tests/archive-tunnel.test.mjs tests/archive-ui.test.mjs
git commit -m "feat: render the approved front-facing archive tunnel"
```

### Task 3: Match version-15 cruise, rewind and modal composition

**Files:**
- Modify: `src/archive-ui.js`
- Modify: `src/archive-case-modal.js`
- Modify: `style.css`
- Test: `tests/archive-ui.test.mjs`
- Test: `tests/archive-case-modal.test.mjs`

- [ ] **Step 1: Add failing integration assertions**

Assert 90-second cruise, 3.2-second rewind, center button state transitions, modal pause/resume at exact progress, low-opacity backdrop, translucent card, and vertical first/last frames.

- [ ] **Step 2: Run and confirm RED where behavior diverges**

Run: `node --test tests/archive-ui.test.mjs tests/archive-case-modal.test.mjs`.

- [ ] **Step 3: Port version-15 composition without weakening current behavior**

Keep current exact data/modal logic. Match version-15 shell hierarchy and CSS values; retain Escape, copy fallback, focus trap, previous/next case navigation, stale-operation guards and idempotent cleanup.

- [ ] **Step 4: Run integration tests and commit**

Run focused tests and `npm.cmd test`.  
Expected: all PASS.

```powershell
git add src/archive-ui.js src/archive-case-modal.js style.css tests/archive-ui.test.mjs tests/archive-case-modal.test.mjs
git commit -m "fix: align archive interactions with the approved preview"
```

### Task 4: Real-browser visual oracle acceptance

**Files:**
- Modify only if a failing acceptance check exposes a defect.
- Test: `tests/responsive-layout.test.mjs`

- [ ] **Step 1: Start the current site and saved preview side by side**

Use 1440×900 and 390×844 Chrome viewports. Capture entrance, mid-tunnel, end/rewind and open two-image modal states for both implementations.

- [ ] **Step 2: Compare the locked visual invariants**

Confirm front-facing concentric depth, small gaps, near-black soft light, no rays/stripes, visible images, the same control hierarchy, and vertical first/last frames. Reject an implementation that merely passes state tests but still resembles the elliptical fly-by.

- [ ] **Step 3: Verify controls and fallback**

Exercise wheel, drag, touch-width layout, pause/resume, selection, Escape, copy, list round trip, end rewind, reduced motion and forced renderer failure.

- [ ] **Step 4: Run final verification and commit acceptance fixes**

Run: `npm.cmd run build:data`  
Run: `npm.cmd test`  
Run: `git diff --check`  
Expected: all commands succeed; review media remains complete and archive ordering remains unchanged.

If acceptance required code changes, commit them with:

```powershell
git add src style.css tests data
git commit -m "fix: complete approved tunnel visual parity"
```

