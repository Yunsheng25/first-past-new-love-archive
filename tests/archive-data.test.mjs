import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const canvasPath = "D:/黑曜石/canvas白板/《初恋旧爱新欢》视频制作.canvas";
const obsidianRoot = "D:/黑曜石";
const archiveModule = await import("../scripts/build-archive-data.mjs").catch(() => ({}));
const utils = await import("../scripts/web-data-utils.mjs").catch(() => ({}));

function required(module, name) {
  assert.equal(typeof module[name], "function", `${name} must be exported`);
  return module[name];
}

function fixtureCanvas(nodes) {
  return { nodes: nodes.map((node, index) => ({
    id: node.id || `node-${index + 1}`,
    type: "text",
    text: node.text,
    x: node.x ?? index * 100,
    y: node.y ?? 0,
    width: 100,
    height: 100,
  })), edges: [] };
}

function writeFixture(root, nodes) {
  const vault = path.join(root, "vault");
  const sourceDir = path.join(vault, "canvas白板");
  const sourcePath = path.join(sourceDir, "story.canvas");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(sourcePath, JSON.stringify(fixtureCanvas(nodes)), "utf8");
  return { vault, sourcePath };
}

test("resolves all 137 real source images with no missing or ambiguous names", () => {
  const parseCanvasArchive = required(utils, "parseCanvasArchive");
  const resolveImageSources = required(archiveModule, "resolveImageSources");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const archive = parseCanvasArchive(raw);
  const refs = [...new Set(archive.cases.flatMap((item) => item.images.map((image) => image.originalRef)))];
  const sources = resolveImageSources(refs, obsidianRoot);

  assert.equal(sources.size, 137);
  assert.ok([...sources.values()].every((source) => fs.existsSync(source)));
});

test("uses exact vault-relative paths and rejects ambiguous bare basenames", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-ambiguous-"));
  const { vault, sourcePath } = writeFixture(tempDir, [
    { text: "![[a/same.png]] ![[b/same.png]]\n叠化转场" },
  ]);
  fs.mkdirSync(path.join(vault, "a"), { recursive: true });
  fs.mkdirSync(path.join(vault, "b"), { recursive: true });
  fs.writeFileSync(path.join(vault, "a", "same.png"), "A", "utf8");
  fs.writeFileSync(path.join(vault, "b", "same.png"), "B", "utf8");
  const workspace = path.join(tempDir, "workspace");

  try {
    const payload = writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault });
    const contents = payload.cases[0].images.map((image) =>
      fs.readFileSync(path.join(workspace, image.src), "utf8"));
    assert.deepEqual(contents, ["A", "B"]);

    fs.writeFileSync(sourcePath, JSON.stringify(fixtureCanvas([{ text: "![[same.png]]\n转场" }])), "utf8");
    assert.throws(
      () => writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault }),
      /Ambiguous archive image: same\.png.*a[\\/]same\.png.*b[\\/]same\.png/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects paths that could overwrite source or workspace boundaries", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-safe-"));
  const { vault, sourcePath } = writeFixture(tempDir, [{ text: "![[asset.png]]\n水彩画面" }]);
  const sourceImage = path.join(vault, "asset.png");
  const workspace = path.join(tempDir, "workspace");
  const marker = path.join(workspace, "marker.txt");
  fs.writeFileSync(sourceImage, "source", "utf8");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(marker, "keep", "utf8");

  try {
    const safe = writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault });
    assert.equal(safe.summary.missingImages, 0);
    assert.equal(fs.readFileSync(marker, "utf8"), "keep");

    for (const mediaOutputDir of [
      path.parse(tempDir).root,
      tempDir,
      workspace,
      vault,
      sourcePath,
      sourceImage,
      path.join(sourceImage, "nested"),
    ]) {
      assert.throws(
        () => writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault, mediaOutputDir }),
        /Unsafe archive media output directory/,
      );
      assert.equal(fs.readFileSync(marker, "utf8"), "keep");
    }

    const mediaOutputDir = path.join(workspace, "assets", "canvas-images");
    for (const outputPath of [
      sourcePath,
      path.join(vault, "archive.json"),
      sourceImage,
      mediaOutputDir,
      path.join(mediaOutputDir, "archive.json"),
      workspace,
    ]) {
      assert.throws(
        () => writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault, mediaOutputDir, outputPath }),
        /Unsafe archive output path/,
      );
      assert.equal(fs.readFileSync(marker, "utf8"), "keep");
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("keeps existing archive outputs intact when a copy fails", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-atomic-"));
  const { vault, sourcePath } = writeFixture(tempDir, [
    { text: "![[a.png]] ![[b.png]]\n首帧尾帧" },
  ]);
  fs.writeFileSync(path.join(vault, "a.png"), "A", "utf8");
  fs.writeFileSync(path.join(vault, "b.png"), "B", "utf8");
  const workspace = path.join(tempDir, "workspace");
  const outputPath = path.join(workspace, "data", "archive.json");
  const mediaOutputDir = path.join(workspace, "assets", "canvas-images");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(mediaOutputDir, { recursive: true });
  fs.writeFileSync(outputPath, "{\"previous\":true}", "utf8");
  fs.writeFileSync(path.join(mediaOutputDir, "previous.txt"), "previous media", "utf8");
  let attempts = 0;

  try {
    assert.throws(() => writeArchiveData({
      workspace,
      canvasPath: sourcePath,
      obsidianRoot: vault,
      outputPath,
      mediaOutputDir,
      copyFile(source, target) {
        attempts += 1;
        if (attempts === 2) throw new Error("copy exploded");
        fs.copyFileSync(source, target);
      },
    }), /copy exploded/);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "{\"previous\":true}");
    assert.equal(fs.readFileSync(path.join(mediaOutputDir, "previous.txt"), "utf8"), "previous media");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writes stable local assets, UTF-8 JSON, and reproducible metadata", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-write-"));
  const { vault, sourcePath } = writeFixture(tempDir, [
    { text: "![[one.png]] ![[one.png]]\n婚礼教堂的叠化转场" },
  ]);
  fs.writeFileSync(path.join(vault, "one.png"), "ONE", "utf8");
  const workspace = path.join(tempDir, "workspace");

  try {
    const payload = writeArchiveData({
      workspace,
      canvasPath: sourcePath,
      obsidianRoot: vault,
      clock: () => new Date("2026-07-18T00:00:00.000Z"),
    });
    const outputPath = path.join(workspace, "data", "archive.json");
    const writtenText = fs.readFileSync(outputPath, "utf8");
    const written = JSON.parse(writtenText);

    assert.equal(payload.generatedAt, "2026-07-18T00:00:00.000Z");
    assert.equal(written.summary.imageOccurrences, 2);
    assert.equal(written.summary.uniqueImages, 1);
    assert.equal(written.summary.missingImages, 0);
    assert.equal(fs.readdirSync(path.join(workspace, "assets", "canvas-images")).length, 1);
    assert.equal(written.cases[0].images[0].src, written.cases[0].images[1].src);
    assert.ok(written.cases[0].images.every((image) => image.src.startsWith("assets/canvas-images/")));
    assert.ok(!writtenText.includes("\uFFFD"));

    writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault });
    assert.deepEqual(
      fs.readdirSync(path.join(workspace, "assets"), { withFileTypes: true })
        .filter((entry) => entry.name.includes(".backup-")).map((entry) => entry.name),
      [],
    );
    assert.deepEqual(
      fs.readdirSync(path.join(workspace, "data"), { withFileTypes: true })
        .filter((entry) => entry.name.includes(".backup-")).map((entry) => entry.name),
      [],
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("the legacy build-web-data entry point performs a fixture archive build", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-entry-"));
  const entryPath = fileURLToPath(new URL("../build-web-data.mjs", import.meta.url));
  const { vault, sourcePath } = writeFixture(tempDir, [{ text: "![[entry.png]]\n镜头缓慢抬起" }]);
  fs.writeFileSync(path.join(vault, "entry.png"), "ENTRY", "utf8");
  const workspace = path.join(tempDir, "workspace");

  try {
    const result = spawnSync(process.execPath, [entryPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        ARCHIVE_WORKSPACE: workspace,
        ARCHIVE_CANVAS_PATH: sourcePath,
        ARCHIVE_OBSIDIAN_ROOT: vault,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(workspace, "data", "archive.json")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, "data", "archive.json"), "utf8")).summary.cases, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
