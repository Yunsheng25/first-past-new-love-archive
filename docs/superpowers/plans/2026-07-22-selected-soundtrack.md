# Selected Soundtrack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected generated piano track with the user-selected `Emotional Piano and Strings`, preserving licensing and film pause/resume behavior.

**Architecture:** Store the selected track as a local, verified web asset and make the audio manager receive its source through one exported constant. Keep all existing playback state and film ownership logic; only the asset, default preference, and attribution change.

**Tech Stack:** Static MP3/WAV asset, browser Audio API, Node test runner, ffmpeg/ffprobe.

---

### Task 1: Acquire and verify the selected track

**Files:**
- Create: `assets/audio/emotional-piano-and-strings.mp3`
- Modify: `THIRD_PARTY_NOTICES.md`
- Test: `tests/audio-manager.test.mjs`

- [ ] **Step 1: Write the failing provenance test**

Add assertions that `THIRD_PARTY_NOTICES.md` contains the exact title, author, source URL and `Pixabay Content License`, and that the selected asset exists and is non-empty.

```js
assert.match(notices, /Emotional Piano and Strings/);
assert.match(notices, /Pastichio_Piano_Music/);
assert.match(notices, /289398/);
assert.ok(fs.statSync(trackPath).size > 100_000);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/audio-manager.test.mjs`  
Expected: FAIL because the selected asset and notice do not exist.

- [ ] **Step 3: Download only from the confirmed Pixabay source and verify media**

Save the MP3 locally, then run:

```powershell
ffprobe -v error -show_entries format=duration:stream=codec_name,codec_type -of json assets/audio/emotional-piano-and-strings.mp3
```

Expected: one audio stream, a finite positive duration, and no video stream. Record the source page and license in `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 4: Run the provenance test and confirm GREEN**

Run: `node --test tests/audio-manager.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add assets/audio/emotional-piano-and-strings.mp3 THIRD_PARTY_NOTICES.md tests/audio-manager.test.mjs
git commit -m "feat: add selected piano and strings soundtrack"
```

### Task 2: Switch the manager and default to off

**Files:**
- Modify: `src/audio-manager.js`
- Test: `tests/audio-manager.test.mjs`
- Test: `tests/intro-film-ui.test.mjs`

- [ ] **Step 1: Add failing source/default tests**

Assert that a manager created without injected audio uses the selected asset, and that a missing preference starts disabled while stored `true` starts enabled.

```js
assert.equal(createdAudio.src, 'assets/audio/emotional-piano-and-strings.mp3');
assert.equal(manager.snapshot().enabled, false);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/audio-manager.test.mjs tests/intro-film-ui.test.mjs`  
Expected: FAIL on the old filename and current default-enabled behavior.

- [ ] **Step 3: Implement the exact source and preference rule**

```js
export const BGM_SOURCE = 'assets/audio/emotional-piano-and-strings.mp3';
const player = audio ?? (typeof Audio === 'function' ? new Audio(BGM_SOURCE) : null);
let enabled = preferenceStore?.getItem(BGM_PREFERENCE_KEY) === 'true';
```

Do not change gesture gating, film pause/resume ownership, fades, or cleanup.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/audio-manager.test.mjs tests/intro-film-ui.test.mjs`  
Expected: PASS.  
Run: `npm.cmd test`  
Expected: all tests PASS.

- [ ] **Step 5: Browser acceptance and commit**

Verify first load is silent, manual enable plays the new track, entering film pauses it, leaving film resumes it only when enabled, and the control can disable it. Then commit:

```powershell
git add src/audio-manager.js tests/audio-manager.test.mjs tests/intro-film-ui.test.mjs
git commit -m "fix: use the approved website soundtrack"
```

