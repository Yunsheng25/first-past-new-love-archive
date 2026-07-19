import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { paginateBlocks, parseReview, writeReviewData } from "../scripts/build-review-data.mjs";

const reviewPath = "D:/\u9ed1\u66dc\u77f3/\u4ea7\u54c1\u8d44\u6599/\u300a\u521d\u604b\u65e7\u7231\u65b0\u6b22\u300b\u89c6\u9891\u590d\u76d8/\u300a\u521d\u604b\u65e7\u7231\u65b0\u6b22\u300b\u590d\u76d8\u624b\u8bb0.md";
const obsidianRoot = "D:/\u9ed1\u66dc\u77f3";
const committedReviewPath = "data/review.json";
const committedMediaDir = "assets/review-media";
const originTitle = "\u9879\u76ee\u7f18\u8d77\uff1a\u6211\u4e3a\u4ec0\u4e48\u8981\u505a\u8fd9\u4e2a\u89c6\u9891";
const expectedChapters = [
  ["origin", originTitle],
  ["story", "\u6545\u4e8b\u8bbe\u8ba1\uff1a\u4e00\u4e2a\u60f3\u6cd5\u600e\u4e48\u53d8\u6210\u5b8c\u6574\u53d9\u4e8b"],
  ["production", "\u5236\u4f5c\u6267\u884c\uff1a\u751f\u56fe\u3001\u89c6\u9891\u4e0e\u526a\u8f91"],
  ["reflection", "\u56de\u770b\u6210\u7247\uff1a\u6211\u770b\u5230\u7684\u4e0d\u8db3"],
  ["closing", "\u5199\u5728\u6700\u540e"],
];

const chapterByTitle = new Map(expectedChapters.map(([slug, title]) => [title, slug]));

function independentMediaDetails(rawRef) {
  const ref = rawRef.split("|")[0].trim();
  const extension = path.extname(ref).toLowerCase();
  const type = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)
    ? "image"
    : [".mp4", ".webm", ".mov"].includes(extension)
      ? "video"
      : "media";
  return { type, ref };
}

function independentStableName(ref, number) {
  const basename = path.win32.basename(ref).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
  return `${String(number).padStart(3, "0")}-${basename}`;
}

function independentlyParseAuthoredBlocks(markdown) {
  const chapters = [];
  let chapter;
  let section;
  let paragraph = [];

  const appendText = (text) => {
    const normalized = text.replace(/\r?\n/g, "\n").trim();
    if (normalized) chapter.blocks.push({ type: "text", text: normalized, section: section.title });
  };
  const flushParagraph = () => {
    if (!chapter || paragraph.length === 0) return;
    const text = paragraph.map((line) => line.replace(/^\s*>\s?/, "")).join("\n");
    const embeds = /!\[\[([^\]]+)\]\]/g;
    let cursor = 0;
    let match;
    while ((match = embeds.exec(text))) {
      appendText(text.slice(cursor, match.index));
      const rawRef = match[1].trim();
      chapter.blocks.push({ ...independentMediaDetails(rawRef), rawRef, section: section.title });
      cursor = match.index + match[0].length;
    }
    appendText(text.slice(cursor));
    paragraph = [];
  };

  for (const line of String(markdown).replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2];
      const slug = level === 2 ? chapterByTitle.get(title) : undefined;
      if (slug) {
        chapter = { slug, title, sections: [], blocks: [] };
        chapters.push(chapter);
        section = { title, level, index: 0 };
        chapter.sections.push(section);
      } else if (chapter) {
        section = { title, level, index: chapter.blocks.length };
        chapter.sections.push(section);
        chapter.blocks.push({ type: "heading", text: title, level, section: title });
      }
    } else if (chapter && line.trim() === "") {
      flushParagraph();
    } else if (chapter) {
      paragraph.push(line);
    }
  }
  flushParagraph();

  const srcByRef = new Map();
  let uniqueNumber = 0;
  for (const item of chapters) {
    for (const block of item.blocks) {
      if (!["image", "video", "media"].includes(block.type)) continue;
      if (!srcByRef.has(block.ref)) {
        srcByRef.set(block.ref, `assets/review-media/${independentStableName(block.ref, ++uniqueNumber)}`);
      }
      block.src = srcByRef.get(block.ref);
    }
  }
  return chapters;
}

function normalizeVaultRef(ref) {
  return String(ref).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").toLowerCase();
}

function independentlyResolveSourceMedia(refs, vaultRoot) {
  const wantedBasenames = new Set(refs.map((ref) => path.posix.basename(normalizeVaultRef(ref))));
  const byBasename = new Map();
  const byRelativePath = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const relativePath = normalizeVaultRef(path.relative(vaultRoot, fullPath));
      const basename = path.posix.basename(relativePath);
      if (!wantedBasenames.has(basename)) continue;
      byRelativePath.set(relativePath, fullPath);
      byBasename.set(basename, [...(byBasename.get(basename) || []), fullPath]);
    }
  };
  walk(vaultRoot);

  return new Map(refs.map((ref) => {
    const normalized = normalizeVaultRef(ref);
    if (normalized.includes("/")) {
      const source = byRelativePath.get(normalized);
      assert.ok(source, `independent source resolution for ${ref}`);
      return [ref, source];
    }
    const candidates = byBasename.get(path.posix.basename(normalized)) || [];
    assert.equal(candidates.length, 1, `independent source resolution for ${ref}`);
    return [ref, candidates[0]];
  }));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertReviewAssetIntegrity(mediaDirectory) {
  const authored = independentlyParseAuthoredBlocks(fs.readFileSync(reviewPath, "utf8"));
  const media = authored.flatMap((chapter) => chapter.blocks)
    .filter((block) => ["image", "video", "media"].includes(block.type));
  const refs = [...new Set(media.map((block) => block.ref))];
  const sourceByRef = independentlyResolveSourceMedia(refs, obsidianRoot);
  const expectedLocalNames = refs.map((ref, index) => independentStableName(ref, index + 1));

  assert.equal(media.length, 51);
  assert.equal(refs.length, 49);
  assert.deepEqual(fs.readdirSync(mediaDirectory).sort(), expectedLocalNames.toSorted());
  for (const [index, ref] of refs.entries()) {
    const localPath = path.join(mediaDirectory, expectedLocalNames[index]);
    assert.equal(sha256(localPath), sha256(sourceByRef.get(ref)), `SHA-256 mismatch for ${ref}`);
  }
}

function mediaBlocks(review) {
  return review.chapters.flatMap((chapter) =>
    chapter.blocks.filter((block) => block.type === "image" || block.type === "video"),
  );
}

test("committed review JSON preserves every independently parsed authored block and page occurrence", () => {
  const expected = independentlyParseAuthoredBlocks(fs.readFileSync(reviewPath, "utf8"));
  const committed = JSON.parse(fs.readFileSync(committedReviewPath, "utf8"));

  assert.deepEqual(
    committed.chapters.map(({ slug, title, sections, blocks }) => ({ slug, title, sections, blocks })),
    expected,
  );
  assert.equal(committed.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0), 27);
  for (const chapter of committed.chapters) {
    assert.ok(chapter.pages.every((page) => page.length > 0), `${chapter.slug} has no empty page`);
    assert.deepEqual(chapter.pages.flat(), chapter.blocks, `${chapter.slug} pages preserve its complete block sequence`);
  }

  const media = mediaBlocks(committed);
  assert.equal(media.length, 51);
  assert.equal(new Set(media.map((block) => block.ref)).size, 49);
});

test("every committed review asset has the independently resolved source SHA-256 for its authored ref", () => {
  assertReviewAssetIntegrity(committedMediaDir);
});

test("review asset integrity rejects two authored destination files whose contents are swapped", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-media-swap-"));
  const names = fs.readdirSync(committedMediaDir).sort();
  try {
    for (const name of names) {
      fs.linkSync(path.resolve(committedMediaDir, name), path.join(tempDir, name));
    }
    fs.rmSync(path.join(tempDir, names[0]));
    fs.rmSync(path.join(tempDir, names[1]));
    fs.linkSync(path.resolve(committedMediaDir, names[1]), path.join(tempDir, names[0]));
    fs.linkSync(path.resolve(committedMediaDir, names[0]), path.join(tempDir, names[1]));

    assert.throws(
      () => assertReviewAssetIntegrity(tempDir),
      /SHA-256 mismatch for Pasted image 20260619214557\.png/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseReview extracts the five authored chapters, sections, and every media occurrence", () => {
  const markdown = fs.readFileSync(reviewPath, "utf8");
  const review = parseReview(markdown);

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
  assert.deepEqual(
    media.map((block) => block.rawRef),
    [...markdown.matchAll(/!\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()),
  );
  assert.equal(review.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0), 27);
  assert.ok(review.chapters.flatMap((chapter) => chapter.pages).every((page) => page.at(-1)?.type !== "heading"));
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

test("paginateBlocks never returns an empty page after rebalancing", () => {
  const blocks = [
    { type: "text", text: "甲".repeat(500) },
    { type: "text", text: "乙".repeat(500) },
  ];
  const pages = paginateBlocks(blocks, 900);

  assert.ok(pages.every((page) => page.length > 0));
  assert.deepEqual(pages.flat(), blocks);
});

test("paginateBlocks keeps headings with their first paragraph and text with following media", () => {
  const blocks = [
    { type: "heading", text: "小标题", level: 3 },
    { type: "text", text: "甲".repeat(920) },
    { type: "text", text: "乙".repeat(700) },
    { type: "image", ref: "scene.png", src: "assets/review-media/scene.png" },
    { type: "video", ref: "scene.mp4", src: "assets/review-media/scene.mp4" },
    { type: "text", text: "丙".repeat(700) },
  ];
  const pages = paginateBlocks(blocks, 900);

  assert.deepEqual(pages.flat(), blocks);
  assert.deepEqual(pages[0].map((block) => block.type), ["heading", "text"]);
  assert.deepEqual(pages[1].map((block) => block.type), ["text", "image", "video"]);
  assert.ok(pages.every((page) => page.at(-1)?.type !== "heading"));
  for (const page of pages.slice(0, -1)) {
    const textSize = page.filter((block) => block.type === "text" || block.type === "heading")
      .reduce((sum, block) => sum + block.text.length, 0);
    assert.ok(textSize >= 600 && textSize <= 1000, `unexpected page text size ${textSize}`);
  }
});

test("writeReviewData copies all media and writes readable UTF-8 pages", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-data-"));
  const outputPath = path.join(tempDir, "review.json");
  const mediaOutputDir = path.join(tempDir, "review-media");

  try {
    const review = writeReviewData({ workspace: tempDir, markdownPath: reviewPath, obsidianRoot, outputPath, mediaOutputDir });
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const media = mediaBlocks(review);
    const pageCount = review.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);

    assert.equal(media.length, 51);
    assert.equal(media.filter((block) => block.type === "image").length, 25);
    assert.equal(media.filter((block) => block.type === "video").length, 26);
    assert.equal(new Set(media.map((block) => block.ref)).size, 49);
    assert.equal(fs.readdirSync(mediaOutputDir).length, 49);
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
  const markdownDir = path.join(tempDir, "notes");
  const vaultDir = path.join(tempDir, "vault");
  const fixturePath = path.join(markdownDir, "fixture.md");
  fs.mkdirSync(markdownDir);
  fs.mkdirSync(vaultDir);
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[missing-image.png]] ![[missing-video.mp4]]`, "utf8");

  try {
    let error;
    assert.throws(
      () => writeReviewData({
        workspace: tempDir,
        markdownPath: fixturePath,
        obsidianRoot: vaultDir,
        outputPath: path.join(tempDir, "review.json"),
        mediaOutputDir: path.join(tempDir, "review-media"),
      }),
    );
    try {
      writeReviewData({
        workspace: tempDir,
        markdownPath: fixturePath,
        obsidianRoot: vaultDir,
        outputPath: path.join(tempDir, "review.json"),
        mediaOutputDir: path.join(tempDir, "review-media"),
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.match(error.message, /missing-image\.png/);
    assert.match(error.message, /missing-video\.mp4/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData copies fixture media into the requested media directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-copy-"));
  const markdownDir = path.join(tempDir, "notes");
  const fixturePath = path.join(markdownDir, "fixture.md");
  const sourceDir = path.join(tempDir, "source");
  const mediaOutputDir = path.join(tempDir, "website-media");
  fs.mkdirSync(markdownDir);
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "fixture.png"), "fixture", "utf8");
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[fixture.png]]`, "utf8");

  try {
    const review = writeReviewData({
      workspace: tempDir,
      markdownPath: fixturePath,
      obsidianRoot: sourceDir,
      outputPath: path.join(tempDir, "review.json"),
      mediaOutputDir,
    });
    const block = mediaBlocks(review)[0];
    assert.ok(fs.existsSync(path.join(mediaOutputDir, path.basename(block.src))));
    assert.equal(fs.readFileSync(path.join(mediaOutputDir, path.basename(block.src)), "utf8"), "fixture");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData resolves directory-qualified duplicate basenames and rejects ambiguous bare names", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-ambiguous-"));
  const markdownDir = path.join(tempDir, "notes");
  const fixturePath = path.join(markdownDir, "fixture.md");
  const vaultDir = path.join(tempDir, "vault");
  const mediaOutputDir = path.join(tempDir, "review-media");
  fs.mkdirSync(markdownDir);
  fs.mkdirSync(path.join(vaultDir, "a"), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, "b"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "a", "same.png"), "A", "utf8");
  fs.writeFileSync(path.join(vaultDir, "b", "same.png"), "B", "utf8");

  try {
    fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[a/same.png]] ![[b/same.png]]`, "utf8");
    const qualified = writeReviewData({
      workspace: tempDir,
      markdownPath: fixturePath,
      obsidianRoot: vaultDir,
      outputPath: path.join(tempDir, "review.json"),
      mediaOutputDir,
    });
    const copiedContents = mediaBlocks(qualified)
      .map((block) => fs.readFileSync(path.join(mediaOutputDir, path.basename(block.src)), "utf8"));
    assert.deepEqual(copiedContents, ["A", "B"]);

    fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[same.png]]`, "utf8");
    let error;
    try {
      writeReviewData({
        workspace: tempDir,
        markdownPath: fixturePath,
        obsidianRoot: vaultDir,
        outputPath: path.join(tempDir, "review.json"),
        mediaOutputDir,
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.match(error.message, /Ambiguous review media: same\.png/);
    assert.match(error.message, /a[\\/]same\.png/);
    assert.match(error.message, /b[\\/]same\.png/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData rejects unsafe media output paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-unsafe-"));
  const sourceDir = path.join(tempDir, "source");
  const fixturePath = path.join(sourceDir, "fixture.md");
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[missing.png]]`, "utf8");

  try {
    for (const mediaOutputDir of [path.parse(tempDir).root, tempDir, sourceDir, path.dirname(sourceDir)]) {
      assert.throws(() => writeReviewData({
        workspace: tempDir,
        markdownPath: fixturePath,
        obsidianRoot: tempDir,
        outputPath: path.join(tempDir, "review.json"),
        mediaOutputDir,
      }), /Unsafe media output directory/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData protects workspace, source, and output path boundaries", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-path-boundaries-"));
  const workspace = path.join(tempDir, "workspace");
  const vaultDir = path.join(tempDir, "vault");
  const markdownDir = path.join(tempDir, "notes");
  const markdownPath = path.join(markdownDir, "fixture.md");
  const sourceMedia = path.join(vaultDir, "asset.png");
  const markerPath = path.join(workspace, "marker.txt");
  const mediaOutputDir = path.join(workspace, "assets", "review-media");
  const originalMarkdown = `## ${originTitle}\n\n![[asset.png]]`;
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(markdownDir, { recursive: true });
  fs.writeFileSync(markerPath, "workspace marker", "utf8");
  fs.writeFileSync(sourceMedia, "source media", "utf8");
  fs.writeFileSync(markdownPath, originalMarkdown, "utf8");

  const assertUnchanged = () => {
    assert.equal(fs.readFileSync(markerPath, "utf8"), "workspace marker");
    assert.equal(fs.readFileSync(markdownPath, "utf8"), originalMarkdown);
  };
  const options = { workspace, markdownPath, obsidianRoot: vaultDir, mediaOutputDir };

  try {
    const safe = writeReviewData(options);
    assert.equal(mediaBlocks(safe).length, 1, "default workspace output layout remains allowed");
    assertUnchanged();

    for (const unsafeMediaDir of [
      tempDir,
      markdownPath,
      vaultDir,
      sourceMedia,
      path.join(sourceMedia, "nested"),
    ]) {
      assert.throws(() => writeReviewData({ ...options, mediaOutputDir: unsafeMediaDir }), /Unsafe media output directory/);
      assertUnchanged();
    }

    for (const unsafeOutputPath of [
      markdownPath,
      path.join(vaultDir, "review.json"),
      sourceMedia,
      mediaOutputDir,
      path.join(mediaOutputDir, "review.json"),
      path.join(workspace, "assets"),
      workspace,
    ]) {
      assert.throws(() => writeReviewData({ ...options, outputPath: unsafeOutputPath }), /Unsafe review output path/);
      assertUnchanged();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData rejects sibling outputs before changing external markers", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-workspace-boundary-"));
  const workspace = path.join(tempDir, "workspace");
  const vaultDir = path.join(tempDir, "vault");
  const markdownPath = path.join(tempDir, "notes", "fixture.md");
  const externalMedia = path.join(tempDir, "external-media");
  const externalOutput = path.join(tempDir, "external-review.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.mkdirSync(externalMedia, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "asset.png"), "source", "utf8");
  fs.writeFileSync(markdownPath, `## ${originTitle}\n\n![[asset.png]]`, "utf8");
  fs.writeFileSync(path.join(externalMedia, "marker.txt"), "media marker", "utf8");
  fs.writeFileSync(externalOutput, "output marker", "utf8");

  try {
    await t.test("rejects mediaOutputDir outside workspace", () => {
      assert.throws(() => writeReviewData({
        workspace,
        markdownPath,
        obsidianRoot: vaultDir,
        mediaOutputDir: externalMedia,
      }), /Unsafe media output directory/);
      assert.equal(fs.readFileSync(path.join(externalMedia, "marker.txt"), "utf8"), "media marker");
    });

    await t.test("rejects outputPath outside workspace", () => {
      assert.throws(() => writeReviewData({
        workspace,
        markdownPath,
        obsidianRoot: vaultDir,
        outputPath: externalOutput,
      }), /Unsafe review output path/);
      assert.equal(fs.readFileSync(externalOutput, "utf8"), "output marker");
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData keeps existing output intact when copying fails", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-atomic-"));
  const sourceDir = path.join(tempDir, "source");
  const fixturePath = path.join(sourceDir, "fixture.md");
  const outputPath = path.join(tempDir, "review.json");
  const mediaOutputDir = path.join(tempDir, "review-media");
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(mediaOutputDir);
  fs.writeFileSync(path.join(sourceDir, "a.png"), "A", "utf8");
  fs.writeFileSync(path.join(sourceDir, "b.png"), "B", "utf8");
  fs.writeFileSync(path.join(mediaOutputDir, "previous.txt"), "previous media", "utf8");
  fs.writeFileSync(outputPath, '{"previous":true}', "utf8");
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[a.png]] ![[b.png]]`, "utf8");
  let attempts = 0;

  try {
    assert.throws(() => writeReviewData({
      workspace: tempDir,
      markdownPath: fixturePath,
      obsidianRoot: sourceDir,
      outputPath,
      mediaOutputDir,
      copyFile(source, target) {
        attempts += 1;
        if (attempts === 2) throw new Error("copy exploded");
        fs.copyFileSync(source, target);
      },
    }), /copy exploded/);
    assert.equal(fs.readFileSync(path.join(mediaOutputDir, "previous.txt"), "utf8"), "previous media");
    assert.equal(fs.readFileSync(outputPath, "utf8"), '{"previous":true}');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData accepts an injected clock for reproducible metadata", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-clock-"));
  const markdownDir = path.join(tempDir, "notes");
  const vaultDir = path.join(tempDir, "vault");
  const fixturePath = path.join(markdownDir, "fixture.md");
  const outputPath = path.join(tempDir, "review.json");
  fs.mkdirSync(markdownDir);
  fs.mkdirSync(vaultDir);
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n文字`, "utf8");

  try {
    writeReviewData({
      workspace: tempDir,
      markdownPath: fixturePath,
      obsidianRoot: vaultDir,
      outputPath,
      mediaOutputDir: path.join(tempDir, "review-media"),
      clock: () => new Date("2026-07-18T00:00:00.000Z"),
    });
    assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).generatedAt, "2026-07-18T00:00:00.000Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeReviewData reports indexing and copy stages", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-progress-"));
  const markdownDir = path.join(tempDir, "notes");
  const fixturePath = path.join(markdownDir, "fixture.md");
  const sourceDir = path.join(tempDir, "source");
  const stages = [];
  fs.mkdirSync(markdownDir);
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "fixture.png"), "fixture", "utf8");
  fs.writeFileSync(fixturePath, `## ${originTitle}\n\n![[fixture.png]]`, "utf8");

  try {
    writeReviewData({
      workspace: tempDir,
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
