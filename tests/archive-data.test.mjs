import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

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

function independentImageRefs(text = "") {
  return [...String(text).matchAll(/!\[\[([^\]\r\n]+?)\]\]/g)]
    .map((match) => match[1].split("|")[0].trim().replace(/\\/g, "/"))
    .filter((ref) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(ref));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
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

test("every committed tunnel image keeps its original and has a WebP display derivative", () => {
  const archive = JSON.parse(fs.readFileSync("data/archive.json", "utf8"));
  const images = archive.cases.flatMap((item) => item.images);

  assert.equal(images.length, 138);
  assert.equal(new Set(images.map((image) => image.displaySrc)).size, 137);
  for (const image of images) {
    assert.equal(image.originalSrc, image.src);
    assert.match(image.originalSrc, /^assets\/canvas-images\/.+/);
    assert.match(image.displaySrc, /^assets\/archive-display\/.+\.webp$/);
    assert.ok(fs.existsSync(image.displaySrc), image.displaySrc);
  }
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

test("rejects sibling media and JSON outputs before changing their markers", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-workspace-boundary-"));
  const { vault, sourcePath } = writeFixture(tempDir, [{ text: "![[asset.png]]\n水彩画面" }]);
  fs.writeFileSync(path.join(vault, "asset.png"), "source", "utf8");
  const workspace = path.join(tempDir, "workspace");
  const externalMedia = path.join(tempDir, "external-media");
  const externalOutput = path.join(tempDir, "external-output.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(externalMedia, { recursive: true });
  fs.writeFileSync(path.join(externalMedia, "marker.txt"), "media marker", "utf8");
  fs.writeFileSync(externalOutput, "output marker", "utf8");

  try {
    assert.throws(() => writeArchiveData({
      workspace,
      canvasPath: sourcePath,
      obsidianRoot: vault,
      mediaOutputDir: externalMedia,
    }), /Unsafe archive media output directory/);
    assert.equal(fs.readFileSync(path.join(externalMedia, "marker.txt"), "utf8"), "media marker");

    assert.throws(() => writeArchiveData({
      workspace,
      canvasPath: sourcePath,
      obsidianRoot: vault,
      outputPath: externalOutput,
    }), /Unsafe archive output path/);
    assert.equal(fs.readFileSync(externalOutput, "utf8"), "output marker");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rolls back both official outputs when JSON promotion fails", () => {
  const replaceOutputs = required(archiveModule, "replaceOutputs");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-promotion-failure-"));
  const mediaOutputDir = path.join(tempDir, "media");
  const temporaryMediaDir = path.join(tempDir, "media-next");
  const outputPath = path.join(tempDir, "archive.json");
  const temporaryOutputPath = path.join(tempDir, "archive-next.json");
  fs.mkdirSync(mediaOutputDir);
  fs.mkdirSync(temporaryMediaDir);
  fs.writeFileSync(path.join(mediaOutputDir, "old.txt"), "old media", "utf8");
  fs.writeFileSync(path.join(temporaryMediaDir, "new.txt"), "new media", "utf8");
  fs.writeFileSync(outputPath, "old json", "utf8");
  fs.writeFileSync(temporaryOutputPath, "new json", "utf8");

  try {
    assert.throws(() => replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath }, {
      rename(source, target) {
        if (source === temporaryOutputPath && target === outputPath) throw new Error("json promotion failed");
        fs.renameSync(source, target);
      },
    }), /json promotion failed/);
    assert.equal(fs.readFileSync(path.join(mediaOutputDir, "old.txt"), "utf8"), "old media");
    assert.equal(fs.readFileSync(outputPath, "utf8"), "old json");
    assert.ok(!fs.existsSync(path.join(mediaOutputDir, "new.txt")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("keeps promoted outputs successful when the first backup cleanup attempt fails", () => {
  const replaceOutputs = required(archiveModule, "replaceOutputs");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-cleanup-failure-"));
  const mediaOutputDir = path.join(tempDir, "media");
  const temporaryMediaDir = path.join(tempDir, "media-next");
  const outputPath = path.join(tempDir, "archive.json");
  const temporaryOutputPath = path.join(tempDir, "archive-next.json");
  fs.mkdirSync(mediaOutputDir);
  fs.mkdirSync(temporaryMediaDir);
  fs.writeFileSync(path.join(mediaOutputDir, "old.txt"), "old media", "utf8");
  fs.writeFileSync(path.join(temporaryMediaDir, "new.txt"), "new media", "utf8");
  fs.writeFileSync(outputPath, "old json", "utf8");
  fs.writeFileSync(temporaryOutputPath, "new json", "utf8");
  const warnings = [];
  let firstCleanup = true;

  try {
    replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath }, {
      remove(target, options) {
        if (target.includes(".backup-") && firstCleanup) {
          firstCleanup = false;
          throw new Error("cleanup temporarily unavailable");
        }
        fs.rmSync(target, options);
      },
      onCleanupWarning(warning) {
        warnings.push(warning);
      },
    });
    assert.equal(fs.readFileSync(path.join(mediaOutputDir, "new.txt"), "utf8"), "new media");
    assert.equal(fs.readFileSync(outputPath, "utf8"), "new json");
    assert.ok(warnings.some((warning) => /cleanup temporarily unavailable/.test(warning.message)));
    assert.deepEqual(
      fs.readdirSync(tempDir).filter((name) => name.includes(".backup-")),
      [],
      "successful promotion must not accumulate backup siblings",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archive promotion keeps committed outputs when both backup cleanups persistently fail", () => {
  const replaceOutputs = required(archiveModule, "replaceOutputs");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-persistent-cleanup-"));
  const mediaOutputDir = path.join(tempDir, "media"); const temporaryMediaDir = path.join(tempDir, "media-next");
  const outputPath = path.join(tempDir, "archive.json"); const temporaryOutputPath = path.join(tempDir, "archive-next.json");
  fs.mkdirSync(mediaOutputDir); fs.mkdirSync(temporaryMediaDir);
  fs.writeFileSync(path.join(mediaOutputDir, "old"), "old"); fs.writeFileSync(path.join(temporaryMediaDir, "new"), "new");
  fs.writeFileSync(outputPath, "old"); fs.writeFileSync(temporaryOutputPath, "new");
  const attempts = []; const delays = []; const warnings = [];
  try {
    const result = replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath }, {
      remove(target) { attempts.push(target); throw new Error("locked"); }, sleep() { delays.push(true); },
      onCleanupWarning: (warning) => warnings.push(warning),
    });
    assert.equal(fs.readFileSync(path.join(mediaOutputDir, "new"), "utf8"), "new");
    assert.equal(fs.readFileSync(outputPath, "utf8"), "new");
    assert.equal(attempts.filter((target) => target.includes(".media.backup-")).length, 3);
    assert.equal(attempts.filter((target) => target.includes(".archive.json.backup-")).length, 3);
    assert.equal(delays.length, 4); assert.equal(warnings.length, 6); assert.equal(result.cleanupWarnings.length, 6);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
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

test("can refresh archive JSON from already verified local assets without copying images", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-reuse-"));
  const { vault, sourcePath } = writeFixture(tempDir, [{ text: "![[one.png]]\n镜头缓慢转向前方" }]);
  fs.writeFileSync(path.join(vault, "one.png"), "ONE", "utf8");
  const workspace = path.join(tempDir, "workspace");

  try {
    const initial = writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault });
    const refreshed = writeArchiveData({
      workspace,
      canvasPath: sourcePath,
      obsidianRoot: vault,
      reuseExistingMedia: true,
      clock: () => new Date("2026-07-19T00:00:00.000Z"),
      copyFile() {
        throw new Error("reuse mode must not copy");
      },
    });
    assert.equal(refreshed.generatedAt, initial.generatedAt);
    assert.equal(fs.readFileSync(path.join(workspace, "assets", "canvas-images", "001-one.png"), "utf8"), "ONE");
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, "data", "archive.json"), "utf8")).summary.cases, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("JSON-only refresh does not depend on deleting a temporary sibling", () => {
  const writeArchiveData = required(archiveModule, "writeArchiveData");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-reuse-cleanup-"));
  const { vault, sourcePath } = writeFixture(tempDir, [{ text: "![[one.png]]\n镜头缓慢转向前方" }]);
  fs.writeFileSync(path.join(vault, "one.png"), "ONE", "utf8");
  const workspace = path.join(tempDir, "workspace");
  const originalRmSync = fs.rmSync;
  let leftovers = [];

  try {
    writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault });
    fs.rmSync = (target, options) => {
      if (String(target).includes(".archive.json.tmp-")) return;
      return originalRmSync(target, options);
    };
    writeArchiveData({ workspace, canvasPath: sourcePath, obsidianRoot: vault, reuseExistingMedia: true });
    leftovers = fs.readdirSync(path.join(workspace, "data")).filter((name) => name.includes(".tmp-"));
  } finally {
    fs.rmSync = originalRmSync;
    originalRmSync(tempDir, { recursive: true, force: true });
  }
  assert.deepEqual(leftovers, []);
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

test("every generated real asset is byte-identical to its independently resolved source", () => {
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const archive = JSON.parse(fs.readFileSync("data/archive.json", "utf8"));
  const orderedNodes = raw.nodes
    .filter((node) => node.type === "text")
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  const sourceRefs = orderedNodes.flatMap((node) => independentImageRefs(node.text || ""));
  const uniqueRefs = [...new Set(sourceRefs)];
  const wantedNames = new Set(uniqueRefs.map((ref) => path.posix.basename(ref).toLowerCase()));
  const found = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (wantedNames.has(entry.name.toLowerCase())) {
        const key = entry.name.toLowerCase();
        found.set(key, [...(found.get(key) || []), fullPath]);
      }
    }
  };
  walk(obsidianRoot);
  const localByRef = new Map();
  for (const item of archive.cases) {
    for (const image of item.images) {
      if (!localByRef.has(image.originalRef)) localByRef.set(image.originalRef, image.src);
    }
  }

  assert.equal(uniqueRefs.length, 137);
  for (const ref of uniqueRefs) {
    const candidates = found.get(path.posix.basename(ref).toLowerCase()) || [];
    assert.equal(candidates.length, 1, `independent source resolution for ${ref}`);
    const localPath = path.resolve(localByRef.get(ref));
    assert.equal(sha256(localPath), sha256(candidates[0]), `SHA-256 mismatch for ${ref}`);
  }
});

test("archive JSON preserves the exact authored case/image occurrence signature", () => {
  const archive = JSON.parse(fs.readFileSync("data/archive.json", "utf8"));
  const occurrences = archive.cases.flatMap((item) => item.images.map((image, imageIndex) => [
    imageIndex,
    item.id,
    image.role,
    image.src,
  ]));
  const signature = occurrences.map(([, caseId, role, src], index) => [index + 1, caseId, role, src]);
  const histogram = archive.cases.reduce((counts, item) => {
    counts[item.images.length] = (counts[item.images.length] ?? 0) + 1;
    return counts;
  }, {});

  assert.equal(archive.cases.length, 72);
  assert.equal(signature.length, 138);
  assert.equal(new Set(signature.map(([, , , src]) => src)).size, 137);
  assert.deepEqual(histogram, { 1: 13, 2: 58, 9: 1 });
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(signature)).digest("hex"),
    "196ef58e605fa5de25c68cbf6e4bf285d924dde18d8d515f93f1032948e14bd8",
  );
  for (const item of archive.cases.filter((candidate) => candidate.images.length === 2)) {
    assert.deepEqual(
      item.images.map((image) => [image.role, image.src]),
      occurrences.filter(([, caseId]) => caseId === item.id).map(([, , role, src]) => [role, src]),
      item.id,
    );
  }
});

test("generated real archive derives error attempts exactly from the two authored canvas groups", () => {
  const parseCanvasArchive = required(utils, "parseCanvasArchive");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const parsed = parseCanvasArchive(raw);
  const generated = JSON.parse(fs.readFileSync("data/archive.json", "utf8"));
  const errorLabels = new Set(["出现人脸", "人物呈现的形象特征与前方不符"]);
  const groups = raw.nodes.filter((node) => node.type === "group" && errorLabels.has(node.label || ""));
  const expectedNodeIds = raw.nodes
    .filter((node) => node.type === "text" && independentImageRefs(node.text || "").length > 0)
    .filter((node) => {
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      return groups.some((group) => centerX >= group.x && centerX <= group.x + group.width
        && centerY >= group.y && centerY <= group.y + group.height);
    })
    .map((node) => node.id)
    .sort();
  const actualNodeIds = parsed.cases.filter((item) => item.status === "error").map((item) => item.source.nodeId).sort();
  const generatedNodeIds = generated.cases.filter((item) => item.status === "error").map((item) => item.source.nodeId).sort();

  assert.ok(expectedNodeIds.length > 0, "real canvas must retain authored error sentinels");
  assert.deepEqual(actualNodeIds, expectedNodeIds);
  assert.deepEqual(generatedNodeIds, expectedNodeIds);
  assert.ok(parsed.cases.filter((item) => item.status === "error").every((item) => errorLabels.has(item.errorGroup)));
  assert.ok(parsed.cases.filter((item) => item.status === "normal").every((item) => item.errorGroup === null));
  assert.equal(generated.summary.cases, 72);
  assert.equal(generated.summary.imageOccurrences, 138);
  assert.equal(generated.summary.uniqueImages, 137);
});
