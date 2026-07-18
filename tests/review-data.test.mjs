import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { paginateBlocks, parseReview, writeReviewData } from "../scripts/build-review-data.mjs";

const reviewPath = "D:/\u9ed1\u66dc\u77f3/\u4ea7\u54c1\u8d44\u6599/\u300a\u521d\u604b\u65e7\u7231\u65b0\u6b22\u300b\u89c6\u9891\u590d\u76d8/\u300a\u521d\u604b\u65e7\u7231\u65b0\u6b22\u300b\u590d\u76d8\u624b\u8bb0.md";
const obsidianRoot = "D:/\u9ed1\u66dc\u77f3";
const originTitle = "\u9879\u76ee\u7f18\u8d77\uff1a\u6211\u4e3a\u4ec0\u4e48\u8981\u505a\u8fd9\u4e2a\u89c6\u9891";
const expectedChapters = [
  ["origin", originTitle],
  ["story", "\u6545\u4e8b\u8bbe\u8ba1\uff1a\u4e00\u4e2a\u60f3\u6cd5\u600e\u4e48\u53d8\u6210\u5b8c\u6574\u53d9\u4e8b"],
  ["production", "\u5236\u4f5c\u6267\u884c\uff1a\u751f\u56fe\u3001\u89c6\u9891\u4e0e\u526a\u8f91"],
  ["reflection", "\u56de\u770b\u6210\u7247\uff1a\u6211\u770b\u5230\u7684\u4e0d\u8db3"],
  ["closing", "\u5199\u5728\u6700\u540e"],
];

function mediaBlocks(review) {
  return review.chapters.flatMap((chapter) =>
    chapter.blocks.filter((block) => block.type === "image" || block.type === "video"),
  );
}

test("parseReview extracts the five authored chapters, sections, and every media occurrence", () => {
  const review = parseReview(fs.readFileSync(reviewPath, "utf8"));

  assert.deepEqual(review.chapters.map(({ slug, title }) => [slug, title]), expectedChapters);
  for (const chapter of review.chapters) {
    assert.ok(chapter.blocks.length > 0, `${chapter.slug} has blocks`);
    assert.ok(chapter.sections.length > 0, `${chapter.slug} has sections`);
  }

  const media = mediaBlocks(review);
  assert.equal(media.length, 51);
  assert.equal(media.filter((block) => block.type === "image").length, 25);
  assert.equal(media.filter((block) => block.type === "video").length, 26);
  assert.equal(new Set(media.map((block) => block.ref)).size, 49);
  assert.ok(media.some((block) => block.ref === "Pasted image 20260619214557.png"));
  assert.ok(media.every((block) => block.src.startsWith("assets/review-media/")));
});

test("parseReview preserves inline media sequence and duplicate occurrences", () => {
  const markdown = `## ${originTitle}\n\n\u6587\u5b57A ![[a.png]] \u6587\u5b57B ![[a.png]] \u6587\u5b57C ![[b.mp4]]`;
  const blocks = parseReview(markdown).chapters[0].blocks;

  assert.deepEqual(blocks.map((block) => block.type), ["text", "image", "text", "image", "text", "video"]);
  assert.equal(blocks.filter((block) => block.ref === "a.png").length, 2);
  assert.deepEqual(blocks.filter((block) => block.type === "text").map((block) => block.text), ["\u6587\u5b57A", "\u6587\u5b57B", "\u6587\u5b57C"]);
});

test("paginateBlocks only breaks at block boundaries without losing text", () => {
  const blocks = [
    { type: "text", text: "\u7532".repeat(520) },
    { type: "image", ref: "inline.png", src: "assets/review-media/inline.png" },
    { type: "text", text: "\u4e59".repeat(520) },
    { type: "text", text: "\u4e19".repeat(520) },
  ];
  const pages = paginateBlocks(blocks, 900);

  assert.ok(pages.length > 1);
  assert.deepEqual(pages.flat(), blocks);
  assert.equal(
    pages.flat().filter((block) => block.type === "text").map((block) => block.text).join(""),
    blocks.filter((block) => block.type === "text").map((block) => block.text).join(""),
  );
});

test("writeReviewData copies all media and writes readable UTF-8 pages", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-data-"));
  const outputPath = path.join(tempDir, "review.json");
  const mediaOutputDir = path.join(tempDir, "review-media");

  try {
    const review = writeReviewData({ markdownPath: reviewPath, obsidianRoot, outputPath, mediaOutputDir });
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const media = mediaBlocks(review);
    const pageCount = review.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);

    assert.equal(media.length, 51);
    assert.equal(media.filter((block) => block.type === "image").length, 25);
    assert.equal(media.filter((block) => block.type === "video").length, 26);
    assert.equal(new Set(media.map((block) => block.ref)).size, 49);
    assert.equal(written.chapters.length, 5);
    assert.ok(pageCount >= 20 && pageCount <= 30, `expected 20-30 pages, got ${pageCount}`);
    assert.ok(!fs.readFileSync(outputPath, "utf8").includes("\uFFFD"));
    assert.ok(written.chapters.some((chapter) => chapter.title.includes("\u5236\u4f5c\u6267\u884c")));
    for (const block of media) assert.ok(fs.existsSync(path.join(mediaOutputDir, path.basename(block.src))), block.ref);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData reports every missing media filename", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-missing-"));
  const fixturePath = path.join(tempDir, "fixture.md");
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[missing-image.png]]`, "utf8");

  try {
    assert.throws(
      () => writeReviewData({
        markdownPath: fixturePath,
        obsidianRoot: tempDir,
        outputPath: path.join(tempDir, "review.json"),
        mediaOutputDir: path.join(tempDir, "review-media"),
      }),
      /missing-image\.png/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData copies fixture media into the requested media directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-copy-"));
  const fixturePath = path.join(tempDir, "fixture.md");
  const sourceDir = path.join(tempDir, "source");
  const mediaOutputDir = path.join(tempDir, "website-media");
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "fixture.png"), "fixture", "utf8");
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[fixture.png]]`, "utf8");

  try {
    const review = writeReviewData({
      markdownPath: fixturePath,
      obsidianRoot: sourceDir,
      outputPath: path.join(tempDir, "review.json"),
      mediaOutputDir,
    });
    const block = mediaBlocks(review)[0];
    assert.ok(fs.existsSync(path.join(mediaOutputDir, path.basename(block.src))));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData reports indexing and copy stages", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-progress-"));
  const fixturePath = path.join(tempDir, "fixture.md");
  const sourceDir = path.join(tempDir, "source");
  const stages = [];
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "fixture.png"), "fixture", "utf8");
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[fixture.png]]`, "utf8");

  try {
    writeReviewData({
      markdownPath: fixturePath,
      obsidianRoot: sourceDir,
      outputPath: path.join(tempDir, "review.json"),
      mediaOutputDir: path.join(tempDir, "review-media"),
      onProgress: (stage) => stages.push(stage),
    });
    assert.deepEqual(stages, ["parsed", "indexing-media", "copying-media", "written"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
