import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
