import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFfmpegInfo, readVideoMetadata } from "../scripts/video-metadata.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(HERE);
const BUILD_SCRIPT = path.join(PROJECT_ROOT, "scripts", "build-video-assets.ps1");
const FFMPEG = "C:\\Users\\chenx\\AppData\\Local\\JianyingPro\\Apps\\10.9.0.14199\\ffmpeg.exe";
const POWERSHELL = "powershell.exe";
const FIXTURE_PARENT = mkdtempSync(path.join(tmpdir(), "first-love-video-assets-"));

function removeFixtureTree(target) {
  rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

after(() => {
  removeFixtureTree(FIXTURE_PARENT);
});

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function runPowerShell(args) {
  return spawnSync(
    POWERSHELL,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", BUILD_SCRIPT, ...args],
    { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 120_000 },
  );
}

function scriptArgs(workspace, source, extra = []) {
  return [
    "-WorkspaceRoot", workspace,
    "-InputVideo", source,
    "-Ffmpeg", FFMPEG,
    "-BackgroundEncoder", "h264_qsv",
    "-BackgroundVideoBitrate", "700k",
    "-AllowTemporaryWorkspace",
    ...extra,
  ];
}

function makeFixture(t) {
  const fixtureRoot = path.join(FIXTURE_PARENT, `${process.pid}-${Date.now()}`);
  const source = path.join(fixtureRoot, "fixture-source.mp4");
  mkdirSync(fixtureRoot, { recursive: true });
  t.after(() => removeFixtureTree(fixtureRoot));
  execFileSync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100",
      "-t", "4",
      "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      source,
    ],
    { cwd: PROJECT_ROOT, stdio: "pipe", timeout: 30_000 },
  );
  return { fixtureRoot, source };
}

function assertNoTransactionFiles(outputDirectory) {
  const leftovers = readdirSync(outputDirectory).filter((name) => /\.(?:tmp|backup)\./.test(name));
  assert.deepEqual(leftovers, []);
}

function transactionFiles(outputDirectory) {
  return readdirSync(outputDirectory).filter((name) => /\.(?:tmp|backup)\./.test(name));
}

function assertFastStart(file) {
  const bytes = readFileSync(file);
  const moov = bytes.indexOf(Buffer.from("moov"));
  const mdat = bytes.indexOf(Buffer.from("mdat"));
  assert.ok(moov >= 0 && mdat >= 0 && moov < mdat, `${path.basename(file)} must place moov before mdat`);
}

test("parses duration and stream metadata from ffmpeg diagnostic output", () => {
  const diagnostic = `
Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s
Stream #0:0: Video: h264 (High), yuv420p(tv, progressive), 320x180, 30 fps
Stream #0:1: Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s
`;
  assert.deepEqual(parseFfmpegInfo(diagnostic), {
    durationSeconds: 4,
    video: { codec: "h264", pixelFormat: "yuv420p", width: 320, height: 180 },
    audio: { codec: "aac", sampleRate: 44100, channels: "stereo" },
  });
});

test("fixture harness keeps all generated media outside the project workspace", () => {
  const relative = path.relative(PROJECT_ROOT, FIXTURE_PARENT);
  assert.ok(relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(path.dirname(FIXTURE_PARENT), path.resolve(tmpdir()));
});

test("build creates a four-times-speed silent background and a stream-compatible full film", async (t) => {
  const { fixtureRoot, source } = makeFixture(t);
  const before = { hash: sha256(source), mtimeMs: statSync(source).mtimeMs };

  const result = runPowerShell(scriptArgs(fixtureRoot, source));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const outputDirectory = path.join(fixtureRoot, "assets", "video");
  const backgroundPath = path.join(outputDirectory, "intro-background.mp4");
  const fullFilmPath = path.join(outputDirectory, "full-film.mp4");
  const [input, background, fullFilm] = await Promise.all([
    readVideoMetadata(FFMPEG, source),
    readVideoMetadata(FFMPEG, backgroundPath),
    readVideoMetadata(FFMPEG, fullFilmPath),
  ]);

  assert.ok(Math.abs(background.durationSeconds - input.durationSeconds / 4) <= 0.15);
  assert.equal(background.audio, null);
  assert.equal(background.video.codec, "h264");
  assert.equal(background.video.pixelFormat, "yuv420p");
  assert.ok(background.video.width <= Math.min(1280, input.video.width));
  assert.ok(background.video.height <= Math.min(720, input.video.height));
  assert.ok(statSync(backgroundPath).size < statSync(source).size);
  assertFastStart(backgroundPath);

  assert.ok(Math.abs(fullFilm.durationSeconds - input.durationSeconds) <= 0.05);
  assert.equal(fullFilm.video.codec, input.video.codec);
  assert.equal(fullFilm.audio.codec, input.audio.codec);
  assert.equal(fullFilm.audio.sampleRate, input.audio.sampleRate);
  assert.ok(statSync(fullFilmPath).size <= statSync(source).size * 1.02);
  assertFastStart(fullFilmPath);

  assert.deepEqual({ hash: sha256(source), mtimeMs: statSync(source).mtimeMs }, before);
  assertNoTransactionFiles(outputDirectory);

  const rerun = runPowerShell(scriptArgs(fixtureRoot, source));
  assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
  assert.deepEqual({ hash: sha256(source), mtimeMs: statSync(source).mtimeMs }, before);
  assertNoTransactionFiles(outputDirectory);
});

test("a failed encode preserves official outputs and removes temporary files", (t) => {
  const { fixtureRoot, source } = makeFixture(t);
  const outputDirectory = path.join(fixtureRoot, "assets", "video");
  mkdirSync(outputDirectory, { recursive: true });
  const backgroundPath = path.join(outputDirectory, "intro-background.mp4");
  const fullFilmPath = path.join(outputDirectory, "full-film.mp4");
  writeFileSync(backgroundPath, "old background");
  writeFileSync(fullFilmPath, "old full film");
  const before = { background: sha256(backgroundPath), fullFilm: sha256(fullFilmPath) };

  const result = runPowerShell(scriptArgs(fixtureRoot, source, ["-BackgroundEncoder", "not_an_encoder"]));
  assert.notEqual(result.status, 0);
  assert.deepEqual({ background: sha256(backgroundPath), fullFilm: sha256(fullFilmPath) }, before);
  assertNoTransactionFiles(outputDirectory);
});

test("a post-install failure restores both previous official outputs", (t) => {
  const { fixtureRoot, source } = makeFixture(t);
  const outputDirectory = path.join(fixtureRoot, "assets", "video");
  mkdirSync(outputDirectory, { recursive: true });
  const backgroundPath = path.join(outputDirectory, "intro-background.mp4");
  const fullFilmPath = path.join(outputDirectory, "full-film.mp4");
  writeFileSync(backgroundPath, "previous background");
  writeFileSync(fullFilmPath, "previous full film");
  const before = { background: sha256(backgroundPath), fullFilm: sha256(fullFilmPath) };

  const result = runPowerShell(scriptArgs(fixtureRoot, source, ["-TestFailAfterInstall"]));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Injected post-install failure/i);
  assert.deepEqual({ background: sha256(backgroundPath), fullFilm: sha256(fullFilmPath) }, before);
  assertNoTransactionFiles(outputDirectory);
});

test("partial install rollback continues after one recovery action fails", (t) => {
  const { fixtureRoot, source } = makeFixture(t);
  const outputDirectory = path.join(fixtureRoot, "assets", "video");
  mkdirSync(outputDirectory, { recursive: true });
  const backgroundPath = path.join(outputDirectory, "intro-background.mp4");
  const fullFilmPath = path.join(outputDirectory, "full-film.mp4");
  writeFileSync(backgroundPath, "recoverable only from preserved backup");
  writeFileSync(fullFilmPath, "full film must be restored");
  const oldBackgroundHash = sha256(backgroundPath);
  const oldFullFilmHash = sha256(fullFilmPath);

  const result = runPowerShell(scriptArgs(fixtureRoot, source, [
    "-TestFailSecondInstall",
    "-TestFailFirstRollbackAction",
  ]));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Injected second-install failure/i);
  assert.match(`${result.stdout}\n${result.stderr}`, /Injected first rollback action/i);
  assert.equal(sha256(fullFilmPath), oldFullFilmHash, "recovery must continue to the second pair");

  const leftovers = transactionFiles(outputDirectory);
  const backgroundBackup = leftovers.find((name) => name.startsWith("intro-background.backup."));
  assert.ok(backgroundBackup, "unrecoverable old output backup must be preserved");
  assert.equal(sha256(path.join(outputDirectory, backgroundBackup)), oldBackgroundHash);
  assert.equal(leftovers.some((name) => name.startsWith("full-film.backup.")), false);
  assert.equal(leftovers.some((name) => name.includes(".tmp.")), false);
});

test("post-commit backup cleanup failure warns without failing the build", async (t) => {
  const { fixtureRoot, source } = makeFixture(t);
  const outputDirectory = path.join(fixtureRoot, "assets", "video");
  mkdirSync(outputDirectory, { recursive: true });
  const backgroundPath = path.join(outputDirectory, "intro-background.mp4");
  const fullFilmPath = path.join(outputDirectory, "full-film.mp4");
  writeFileSync(backgroundPath, "old background for cleanup");
  writeFileSync(fullFilmPath, "old full film for cleanup");
  const oldBackgroundHash = sha256(backgroundPath);

  const result = runPowerShell(scriptArgs(fixtureRoot, source, ["-TestFailFirstBackupCleanup"]));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /warning.*backup cleanup/i);
  const [background, fullFilm] = await Promise.all([
    readVideoMetadata(FFMPEG, backgroundPath),
    readVideoMetadata(FFMPEG, fullFilmPath),
  ]);
  assert.equal(background.video.codec, "h264");
  assert.ok(fullFilm.durationSeconds > 0);

  const leftovers = transactionFiles(outputDirectory);
  const backgroundBackup = leftovers.find((name) => name.startsWith("intro-background.backup."));
  assert.ok(backgroundBackup, "persistently undeletable backup must be preserved");
  assert.equal(sha256(path.join(outputDirectory, backgroundBackup)), oldBackgroundHash);
  assert.equal(leftovers.some((name) => name.startsWith("full-film.backup.")), false);
  assert.equal(leftovers.some((name) => name.includes(".tmp.")), false);
});

test("rejects a junction in the output path before writing outside the workspace", (t) => {
  const { fixtureRoot, source } = makeFixture(t);
  const external = path.join(FIXTURE_PARENT, `${process.pid}-${Date.now()}-junction-target`);
  const assetsDirectory = path.join(fixtureRoot, "assets");
  const outputJunction = path.join(assetsDirectory, "video");
  mkdirSync(external, { recursive: true });
  mkdirSync(assetsDirectory, { recursive: true });
  writeFileSync(path.join(external, "marker.txt"), "outside must remain untouched");
  symlinkSync(external, outputJunction, "junction");
  t.after(() => removeFixtureTree(external));

  const result = runPowerShell(scriptArgs(fixtureRoot, source));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /reparse|junction|symbolic/i);
  assert.equal(readFileSync(path.join(external, "marker.txt"), "utf8"), "outside must remain untouched");
  assert.deepEqual(readdirSync(external), ["marker.txt"]);
});

test("rejects output workspaces outside the checked-out project", (t) => {
  const { source } = makeFixture(t);
  const outside = path.join("C:\\tmp", `video-assets-outside-${process.pid}`);
  const result = runPowerShell(scriptArgs(outside, source));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /workspace|工作区/i);
  assert.equal(statSync(source).isFile(), true);
});

test("the default Chinese source filename survives Windows PowerShell 5.1 decoding", () => {
  const result = runPowerShell([
    "-WorkspaceRoot", PROJECT_ROOT,
    "-Ffmpeg", path.join(PROJECT_ROOT, "missing-ffmpeg.exe"),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /FFmpeg was not found/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Input video was not found/i);
});

test("rejects a source path that overlaps an official output", (t) => {
  const fixtureRoot = path.join(FIXTURE_PARENT, `${process.pid}-${Date.now()}-overlap`);
  const source = path.join(fixtureRoot, "assets", "video", "full-film.mp4");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "must remain unchanged");
  t.after(() => removeFixtureTree(fixtureRoot));

  const result = runPowerShell(scriptArgs(fixtureRoot, source));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /overlap|重叠/i);
  assert.equal(readFileSync(source, "utf8"), "must remain unchanged");
  assertNoTransactionFiles(path.dirname(source));
});
