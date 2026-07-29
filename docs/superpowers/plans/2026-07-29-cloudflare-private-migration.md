# Cloudflare Private Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing archive at `film.yunsheng.ccwu.cc` through a new Cloudflare Pages project, then disable GitHub Pages and make the source repository private without an outage.

**Architecture:** Add a deterministic `dist/` builder that copies only runtime files and excludes the 62.32 MiB full film, which exceeds Pages’ 25 MiB per-file limit. Serve the uncompressed film from a dedicated Cloudflare R2 bucket at `media-film.yunsheng.ccwu.cc`, while Cloudflare Pages serves `dist/` at `film.yunsheng.ccwu.cc`. GitHub Pages and public repository visibility are removed only after both Cloudflare services pass acceptance.

**Tech Stack:** Static HTML/CSS/ES modules, Node.js 24, Node test runner, Cloudflare Pages, Cloudflare DNS, GitHub CLI/API

---

## File Map

- Create `scripts/build-cloudflare-site.mjs`: deterministic allow-list publisher for Cloudflare.
- Create `tests/cloudflare-build.test.mjs`: proves required runtime files are copied and private project files are excluded.
- Create `src/site-config.js`: selects local or R2 full-film URL from the current hostname.
- Modify `src/views.js` and `script.js`: use the selected film URL and runtime preload URL.
- Create `tests/site-config.test.mjs`: proves local previews stay local and hosted pages use R2.
- Modify `package.json`: adds `build:cloudflare`.
- Modify `.gitignore`: excludes generated `dist/`.
- Create `wrangler.jsonc`: records the Pages project name and output directory for reproducible local/CLI builds.
- Modify `README.md`: records the production domain and private deployment workflow after cutover.
- Delete `.github/workflows/deploy-pages.yml`: removes the obsolete GitHub Pages deployment after Cloudflare is live.

### Task 1: Build a Minimal Cloudflare Artifact

**Files:**
- Create: `tests/cloudflare-build.test.mjs`
- Create: `scripts/build-cloudflare-site.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing artifact test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudflareSite } from '../scripts/build-cloudflare-site.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('Cloudflare artifact contains runtime files and excludes project internals', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'cloudflare-site-'));
  const output = path.join(temporary, 'dist');
  const result = await buildCloudflareSite({ sourceRoot: root, outputRoot: output });

  for (const relative of [
    'index.html',
    'style.css',
    'script.js',
    'canvas-data.js',
    'preload-manifest.js',
    'data/archive.json',
    'data/review.json',
    'src/router.js',
    'vendor/three.module.min.js',
  ]) {
    assert.equal((await stat(path.join(output, relative))).isFile(), true, relative);
  }

  for (const relative of ['tests', 'docs', '.git', 'package.json', 'scripts']) {
    await assert.rejects(stat(path.join(output, relative)), { code: 'ENOENT' });
  }

  await assert.rejects(
    stat(path.join(output, 'assets/video/full-film.mp4')),
    { code: 'ENOENT' },
  );

  assert.deepEqual(
    await readFile(path.join(output, 'index.html')),
    await readFile(path.join(root, 'index.html')),
  );
  assert.ok(result.files > 100);
  assert.ok(result.bytes > 1_000_000);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/cloudflare-build.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/build-cloudflare-site.mjs`.

- [ ] **Step 3: Implement the allow-list builder**

```js
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOUDFLARE_RUNTIME_ENTRIES = Object.freeze([
  'index.html',
  'style.css',
  'script.js',
  'canvas-data.js',
  'preload-manifest.js',
  'assets',
  'data',
  'src',
  'vendor',
]);

async function measure(target) {
  const details = await stat(target);
  if (details.isFile()) return { files: 1, bytes: details.size };
  const { readdir } = await import('node:fs/promises');
  const children = await readdir(target);
  const totals = await Promise.all(children.map((child) => measure(path.join(target, child))));
  return totals.reduce(
    (sum, item) => ({ files: sum.files + item.files, bytes: sum.bytes + item.bytes }),
    { files: 0, bytes: 0 },
  );
}

export async function buildCloudflareSite({
  sourceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url))),
  outputRoot = path.join(sourceRoot, 'dist'),
} = {}) {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const relative of CLOUDFLARE_RUNTIME_ENTRIES) {
    await cp(path.join(sourceRoot, relative), path.join(outputRoot, relative), {
      recursive: true,
      force: true,
    });
  }

  await rm(path.join(outputRoot, 'assets/video/full-film.mp4'), { force: true });

  return measure(outputRoot);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildCloudflareSite();
  process.stdout.write(`Cloudflare artifact: ${result.files} files, ${result.bytes} bytes\n`);
}
```

- [ ] **Step 4: Wire the package script and ignore generated output**

Add to `package.json` scripts:

```json
"build:cloudflare": "node scripts/build-cloudflare-site.mjs"
```

Add to `.gitignore`:

```gitignore
dist/
```

- [ ] **Step 5: Run artifact and full tests**

Run:

```powershell
npm.cmd run build:cloudflare
node --test tests/cloudflare-build.test.mjs
npm.cmd test
```

Expected: artifact build exits 0; the new test passes; the full suite reports zero failures.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore package.json scripts/build-cloudflare-site.mjs tests/cloudflare-build.test.mjs
git commit -m "build: add minimal Cloudflare Pages artifact"
```

### Task 2: Select the Full-Film Source by Runtime

**Files:**
- Create: `src/site-config.js`
- Create: `tests/site-config.test.mjs`
- Modify: `src/views.js`
- Modify: `script.js`

- [ ] **Step 1: Add failing URL-selection tests**

Test that:

- localhost and file previews use `assets/video/full-film.mp4`;
- `film.yunsheng.ccwu.cc` and `*.pages.dev` use `https://media-film.yunsheng.ccwu.cc/full-film.mp4`;
- only the full-film entry changes in the preload manifest;
- the hosted film element includes `crossorigin="anonymous"`.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
node --test tests/site-config.test.mjs
```

- [ ] **Step 3: Implement the runtime selector**

Create pure helpers in `src/site-config.js`, pass the selected source into `buildFilmView`, and transform the preload list at runtime. Keep all unrelated asset paths unchanged.

- [ ] **Step 4: Verify and commit**

```powershell
node --test tests/site-config.test.mjs
npm.cmd test
git add src/site-config.js src/views.js script.js tests/site-config.test.mjs
git commit -m "feat: serve hosted film from Cloudflare R2"
```

### Task 3: Record Reproducible Pages Configuration

**Files:**
- Create: `wrangler.jsonc`
- Modify: `tests/cloudflare-build.test.mjs`

- [ ] **Step 1: Add a failing configuration assertion**

```js
test('Wrangler config names the isolated project and dist output', async () => {
  const config = JSON.parse(
    (await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'))
      .replace(/^\s*\/\/.*$/gm, ''),
  );
  assert.equal(config.name, 'first-past-new-love-archive');
  assert.equal(config.pages_build_output_dir, './dist');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/cloudflare-build.test.mjs
```

Expected: FAIL with `ENOENT` for `wrangler.jsonc`.

- [ ] **Step 3: Create the config**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "first-past-new-love-archive",
  "pages_build_output_dir": "./dist"
}
```

- [ ] **Step 4: Verify and commit**

```powershell
node --test tests/cloudflare-build.test.mjs
git add wrangler.jsonc tests/cloudflare-build.test.mjs
git commit -m "build: record Cloudflare Pages configuration"
```

### Task 4: Create and Validate the R2 Media Origin

**Files:**
- External Cloudflare R2 and DNS configuration only

- [ ] **Step 1: Create the media bucket**

Create:

```text
Bucket: first-past-new-love-media
Object: full-film.mp4
Source: assets/video/full-film.mp4
```

- [ ] **Step 2: Configure browser access**

Allow `GET` and range requests from:

```text
https://film.yunsheng.ccwu.cc
https://first-past-new-love-archive.pages.dev
```

Expose the range and cache headers needed by the video player and final-frame capture.

- [ ] **Step 3: Attach the media custom domain**

Attach:

```text
media-film.yunsheng.ccwu.cc
```

- [ ] **Step 4: Prove the upload is unchanged and seekable**

Compare the local byte size and SHA-256 with the downloaded R2 object, then request a small byte range.

Expected:

- the full request returns `200`;
- the range request returns `206`;
- `Content-Length`, `Content-Range`, and `Accept-Ranges` are valid;
- the downloaded object is byte-identical to the original 62.32 MiB film.

### Task 5: Publish the Build Preparation to GitHub

**Files:**
- No new files

- [ ] **Step 1: Verify the branch and remote**

```powershell
git status --short
git branch --show-current
git remote -v
```

Expected: only known unrelated untracked local files remain; branch is `master`; origin is `Yunsheng25/first-past-new-love-archive`.

- [ ] **Step 2: Run fresh verification**

```powershell
npm.cmd test
npm.cmd run build:cloudflare
```

Expected: zero test failures and a non-empty `dist/`.

- [ ] **Step 3: Push local master to GitHub main**

```powershell
git push origin master:main
```

Expected: remote `main` advances to the local verified commit.

### Task 6: Create the New Cloudflare Pages Project

**Files:**
- External Cloudflare configuration only

- [ ] **Step 1: Open Cloudflare Pages**

Open:

```text
https://dash.cloudflare.com/?to=/:account/workers-and-pages
```

- [ ] **Step 2: Create a Git-connected Pages project**

Choose:

```text
Create application → Pages → Connect to Git
```

Authorize only:

```text
Yunsheng25/first-past-new-love-archive
```

Set:

```text
Project name: first-past-new-love-archive
Production branch: main
Build command: npm run build:cloudflare
Build output directory: dist
Root directory: /
```

- [ ] **Step 3: Wait for the initial deployment**

Expected: deployment status is Success and Cloudflare provides a URL ending in:

```text
first-past-new-love-archive.pages.dev
```

If Cloudflare requires a one-time GitHub authorization, pause and let the user complete only that authentication prompt.

### Task 7: Verify the Temporary Cloudflare Deployment

**Files:**
- No source changes

- [ ] **Step 1: Verify status and required files**

Run requests against the actual `pages.dev` hostname:

```powershell
$base='https://first-past-new-love-archive.pages.dev'
(Invoke-WebRequest -UseBasicParsing "$base/").StatusCode
(Invoke-WebRequest -UseBasicParsing "$base/script.js").StatusCode
(Invoke-WebRequest -UseBasicParsing "$base/data/review.json").StatusCode
(Invoke-WebRequest -UseBasicParsing "$base/data/archive.json").StatusCode
```

Expected: all return `200`.

- [ ] **Step 2: Verify video range support**

```powershell
curl.exe -sS -D - -o NUL -H "Range: bytes=0-1023" "https://media-film.yunsheng.ccwu.cc/full-film.mp4"
```

Expected: HTTP `206`, `Accept-Ranges: bytes`, and a valid `Content-Range`.

- [ ] **Step 3: Perform browser acceptance**

Check these routes:

```text
/
/#film
/#after
/#review
/#archive
```

Expected: homepage, film controls, after-film choices, review reader, archive tunnel, media, BGM, circular cursor, text motion, and particles match the current production site with no browser errors.

### Task 8: Attach `film.yunsheng.ccwu.cc`

**Files:**
- External Cloudflare Pages and DNS configuration only

- [ ] **Step 1: Add the custom domain from the Pages project**

Open the new Pages project:

```text
Custom domains → Set up a domain
```

Enter:

```text
film.yunsheng.ccwu.cc
```

Expected: Cloudflare creates or validates the corresponding DNS record without changing `yunsheng.ccwu.cc`.

- [ ] **Step 2: Wait for activation**

Expected: custom domain status becomes Active and the certificate status is Active.

- [ ] **Step 3: Repeat the full temporary-domain acceptance against the custom domain**

Set:

```powershell
$base='https://film.yunsheng.ccwu.cc'
```

Repeat Task 7. All checks must pass before Task 9.

### Task 9: Retire GitHub Pages and Make the Repository Private

**Files:**
- Delete: `.github/workflows/deploy-pages.yml`
- Modify: `README.md`

- [ ] **Step 1: Remove the obsolete workflow and document the new production site**

Delete `.github/workflows/deploy-pages.yml`.

Add to `README.md`:

```markdown
## Production deployment

The production site is deployed by Cloudflare Pages from the private `main` branch:

- URL: <https://film.yunsheng.ccwu.cc>
- Build command: `npm run build:cloudflare`
- Output directory: `dist`
```

- [ ] **Step 2: Test, commit, and push while the repository is still public**

```powershell
npm.cmd test
npm.cmd run build:cloudflare
git add .github/workflows/deploy-pages.yml README.md
git commit -m "chore: retire GitHub Pages deployment"
git push origin master:main
```

Expected: Cloudflare automatically deploys the commit and the custom domain remains healthy.

- [ ] **Step 3: Disable GitHub Pages**

```powershell
gh api --method DELETE repos/Yunsheng25/first-past-new-love-archive/pages
```

Expected: GitHub Pages configuration is removed.

- [ ] **Step 4: Change repository visibility**

```powershell
gh repo edit Yunsheng25/first-past-new-love-archive --visibility private --accept-visibility-change-consequences
```

Expected: repository visibility is `PRIVATE`.

- [ ] **Step 5: Verify public GitHub exposure is gone**

```powershell
gh repo view Yunsheng25/first-past-new-love-archive --json visibility,url
```

Expected: `visibility` is `PRIVATE`; unauthenticated access to the repository and old GitHub Pages URL is unavailable.

### Task 10: Prove Private-Repository Auto Deployment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the verified migration date**

Append:

```markdown
Migration verified: 2026-07-29.
```

- [ ] **Step 2: Commit and push after privacy is enabled**

```powershell
git add README.md
git commit -m "docs: confirm private Cloudflare deployment"
git push origin master:main
```

- [ ] **Step 3: Confirm Cloudflare built the new private commit**

Expected: Cloudflare deployment status is Success and its commit SHA equals local `git rev-parse HEAD`.

- [ ] **Step 4: Final live verification**

```powershell
$base='https://film.yunsheng.ccwu.cc'
(Invoke-WebRequest -UseBasicParsing "$base/").StatusCode
curl.exe -sS -D - -o NUL -H "Range: bytes=0-1023" "https://media-film.yunsheng.ccwu.cc/full-film.mp4"
```

Expected: homepage returns `200`; video range returns `206`; browser acceptance still passes.
