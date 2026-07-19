import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const originTitle = "\u9879\u76ee\u7f18\u8d77\uff1a\u6211\u4e3a\u4ec0\u4e48\u8981\u505a\u8fd9\u4e2a\u89c6\u9891";

test("package build:data rebuilds both ordered site datasets from configured sources", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-data-entry-"));
  const vault = path.join(tempDir, "vault");
  const workspace = path.join(tempDir, "site");
  const markdownPath = path.join(vault, "review.md");
  const canvasPath = path.join(vault, "archive.canvas");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "review.png"), "REVIEW", "utf8");
  fs.writeFileSync(path.join(vault, "first.png"), "FIRST", "utf8");
  fs.writeFileSync(path.join(vault, "second.png"), "SECOND", "utf8");
  fs.writeFileSync(
    markdownPath,
    `## ${originTitle}\n\nfirst paragraph ![[review.png]] last paragraph`,
    "utf8",
  );
  fs.writeFileSync(canvasPath, JSON.stringify({
    nodes: [
      { id: "visually-second", type: "text", text: "![[second.png]]\nsecond prompt", x: 0, y: 200 },
      { id: "visually-first", type: "text", text: "![[first.png]]\nfirst prompt", x: 0, y: 100 },
    ],
    edges: [],
  }), "utf8");

  try {
    const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd run build:data"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SITE_DATA_WORKSPACE: workspace,
        REVIEW_MARKDOWN_PATH: markdownPath,
        REVIEW_OBSIDIAN_ROOT: vault,
        ARCHIVE_CANVAS_PATH: canvasPath,
        ARCHIVE_OBSIDIAN_ROOT: vault,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const review = JSON.parse(fs.readFileSync(path.join(workspace, "data", "review.json"), "utf8"));
    const archive = JSON.parse(fs.readFileSync(path.join(workspace, "data", "archive.json"), "utf8"));
    assert.deepEqual(review.chapters.map((chapter) => chapter.slug), ["origin"]);
    assert.deepEqual(
      review.chapters[0].blocks.map((block) => block.type),
      ["text", "image", "text"],
    );
    assert.deepEqual(archive.cases.map((item) => item.source.nodeId), ["visually-first", "visually-second"]);
    assert.deepEqual(
      archive.cases.map((item) => item.images[0].originalRef),
      ["first.png", "second.png"],
    );

    const firstReviewBytes = fs.readFileSync(path.join(workspace, "data", "review.json"));
    const firstArchiveBytes = fs.readFileSync(path.join(workspace, "data", "archive.json"));
    const repeat = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd run build:data"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SITE_DATA_WORKSPACE: workspace,
        REVIEW_MARKDOWN_PATH: markdownPath,
        REVIEW_OBSIDIAN_ROOT: vault,
        ARCHIVE_CANVAS_PATH: canvasPath,
        ARCHIVE_OBSIDIAN_ROOT: vault,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(repeat.status, 0, `${repeat.stdout}\n${repeat.stderr}`);
    assert.deepEqual(fs.readFileSync(path.join(workspace, "data", "review.json")), firstReviewBytes);
    assert.deepEqual(fs.readFileSync(path.join(workspace, "data", "archive.json")), firstArchiveBytes);
    const generatedBackups = [
      ...fs.readdirSync(path.join(workspace, "assets")),
      ...fs.readdirSync(path.join(workspace, "data")),
    ].filter((name) => /^\.(?:canvas-images|review-media)\.backup-|^\.(?:archive|review)\.json\.backup-/.test(name));
    assert.deepEqual(generatedBackups, [], "a successful rebuild must clean only its own backup siblings");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("offline archive tunnel pins and vendors the Three.js r160 module with MIT attributions", async () => {
  const packagePath = path.join(projectRoot, "package.json");
  const lockPath = path.join(projectRoot, "package-lock.json");
  const vendorPath = path.join(projectRoot, "vendor", "three.module.min.js");
  const vendorScriptPath = path.join(projectRoot, "scripts", "vendor-three.mjs");
  const noticesPath = path.join(projectRoot, "THIRD_PARTY_NOTICES.md");

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const lockfile = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const vendor = fs.readFileSync(vendorPath, "utf8");
  const vendorScript = fs.readFileSync(vendorScriptPath, "utf8");
  const notices = fs.readFileSync(noticesPath, "utf8");

  assert.equal(packageJson.dependencies.three, "0.160.1");
  assert.equal(packageJson.scripts["vendor:three"], "node scripts/vendor-three.mjs");
  assert.equal(lockfile.packages["node_modules/three"].version, "0.160.1");
  assert.match(lockfile.packages["node_modules/three"].integrity, /^sha512-/);
  assert.match(vendorScript, /import\.meta\.url/);
  assert.match(vendorScript, /"node_modules", "three", "build", "three\.module\.min\.js"/);
  assert.match(vendorScript, /"vendor"[\s\S]*"three\.module\.min\.js"/);
  const three = await import(pathToFileURL(vendorPath).href);
  assert.equal(three.REVISION, "160");
  assert.match(vendor, /export\s*\{/);
  assert.ok(Object.keys(three).length > 0, "the vendored build must expose ESM exports");
  assert.ok(Buffer.byteLength(vendor) > 100_000, "the vendored ESM build must be nonempty");
  assert.match(notices, /Three\.js[\s\S]*0\.160\.1/);
  assert.match(notices, /The MIT License[\s\S]*Copyright © 2010-2023 three\.js authors[\s\S]*Permission is hereby granted, free of charge/);
  assert.match(notices, /FranzLy\/TimeChannel/);
  assert.match(notices, /The MIT License[\s\S]*Copyright \(c\) 2026 Yu Li[\s\S]*Permission is hereby granted, free of charge/);
});
