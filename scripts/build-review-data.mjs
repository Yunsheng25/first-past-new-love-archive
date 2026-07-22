import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const chapterTitles = [
  ["\u9879\u76ee\u7f18\u8d77\uff1a\u6211\u4e3a\u4ec0\u4e48\u8981\u505a\u8fd9\u4e2a\u89c6\u9891", "origin"],
  ["\u6545\u4e8b\u8bbe\u8ba1\uff1a\u4e00\u4e2a\u60f3\u6cd5\u600e\u4e48\u53d8\u6210\u5b8c\u6574\u53d9\u4e8b", "story"],
  ["\u5236\u4f5c\u6267\u884c\uff1a\u751f\u56fe\u3001\u89c6\u9891\u4e0e\u526a\u8f91", "production"],
  ["\u56de\u770b\u6210\u7247\uff1a\u6211\u770b\u5230\u7684\u4e0d\u8db3", "reflection"],
  ["\u5199\u5728\u6700\u540e", "closing"],
];
const chapterByTitle = new Map(chapterTitles);
const mediaPattern = /!\[\[([^\]]+)\]\]/g;
const calloutStartPattern = /^\s*>\s*\[![^\]]+\]/;
const obsidianRootDefault = "D:/\u9ed1\u66dc\u77f3";
const reviewMarkdownDefault = `${obsidianRootDefault}/\u4ea7\u54c1\u8d44\u6599/\u300a\u521d\u604b\u65e7\u7231\u65b0\u6b22\u300b\u89c6\u9891\u590d\u76d8/\u300a\u521d\u604b\u65e7\u7231\u65b0\u6b22\u300b\u590d\u76d8\u624b\u8bb0.md`;

function mediaDetails(rawRef) {
  const ref = rawRef.split("|")[0].trim();
  const extension = path.extname(ref).toLowerCase();
  const type = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)
    ? "image"
    : [".mp4", ".webm", ".mov"].includes(extension)
      ? "video"
      : "media";
  return { type, ref };
}

function stableName(ref, number) {
  const basename = path.win32.basename(ref).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
  return `${String(number).padStart(3, "0")}-${basename}`;
}

function textBlock(text, section) {
  const normalized = text.replace(/\r?\n/g, "\n").trim();
  return normalized ? { type: "text", text: normalized, section } : null;
}

function blocksForParagraph(paragraph, section, { stripQuoteMarkers = true } = {}) {
  const text = paragraph
    .map((line) => stripQuoteMarkers ? line.replace(/^\s*>\s?/, "") : line)
    .join("\n");
  const blocks = [];
  let cursor = 0;
  mediaPattern.lastIndex = 0;
  let match;

  while ((match = mediaPattern.exec(text))) {
    const before = textBlock(text.slice(cursor, match.index), section);
    if (before) blocks.push(before);
    blocks.push({ ...mediaDetails(match[1]), rawRef: match[1].trim(), section });
    cursor = match.index + match[0].length;
  }
  const after = textBlock(text.slice(cursor), section);
  if (after) blocks.push(after);
  return blocks;
}

function calloutBlock(lines, section) {
  const match = lines[0]?.match(/^\s*>\s*\[!([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const [, kind, title = ""] = match;
  const body = lines.slice(1).map((line) => line.replace(/^\s*>\s?/, ""));
  return {
    type: "callout",
    kind,
    title,
    section,
    children: blocksForParagraph(body, section, { stripQuoteMarkers: false }),
  };
}

function visitBlocks(blocks, visit) {
  for (const block of blocks) {
    visit(block);
    if (block.type === "callout") visitBlocks(block.children, visit);
  }
}

function blockSize(block) {
  if (block.type === "callout") {
    return 180 + block.children.reduce((sum, child) => sum + blockSize(child), 0);
  }
  if (["image", "video", "media"].includes(block.type)) return 260;
  return block.type === "text" || block.type === "heading" ? block.text.length : 0;
}

export function paginateBlocks(blocks, limit = 900) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  for (const block of blocks) {
    if (block.type !== "callout") continue;
    delete block.contextHeading;
    const oversized = blockSize(block) > limit;
    if (oversized) {
      block.oversized = true;
      block.scrollable = true;
    } else {
      delete block.oversized;
      delete block.scrollable;
    }
  }
  const units = semanticUnits(blocks);
  const pages = [];
  let page = [];
  let pageSize = 0;
  for (const unit of units) {
    const size = unitSize(unit);
    if (page.length > 0 && pageSize + size > limit) {
      pages.push(page);
      page = [];
      pageSize = 0;
    }
    page.push(unit);
    pageSize += size;
  }
  if (page.length > 0) pages.push(page);
  rebalancePages(pages, limit);
  return pages.filter((unitsOnPage) => unitsOnPage.length > 0).map((unitsOnPage) => unitsOnPage.flat());
}

function semanticUnits(blocks) {
  const units = [];
  let index = 0;
  const isMedia = (block) => ["image", "video", "media"].includes(block.type);
  const appendMedia = (unit) => {
    while (index < blocks.length && isMedia(blocks[index])) unit.push(blocks[index++]);
  };

  while (index < blocks.length) {
    const block = blocks[index++];
    if (
      block.type === "heading"
      && index < blocks.length
      && blocks[index].type === "callout"
      && blocks[index].oversized
    ) {
      const callout = blocks[index++];
      callout.contextHeading = { ...block };
      units.push([callout]);
      continue;
    }
    const unit = [block];
    if (block.type === "callout") {
      units.push(unit);
      continue;
    } else if (
      block.type === "heading"
      && index < blocks.length
      && blocks[index].type !== "heading"
      && !(blocks[index].type === "callout" && blocks[index].oversized)
    ) {
      unit.push(blocks[index++]);
      if (unit.at(-1).type === "text") appendMedia(unit);
    } else if (block.type === "text") {
      appendMedia(unit);
    } else if (isMedia(block)) {
      appendMedia(unit);
    }
    units.push(unit);
  }
  return units;
}

function unitSize(unit) {
  return unit.reduce((sum, block) => sum + blockSize(block), 0);
}

function rebalancePages(pages, maximumTextSize) {
  const minimumTextSize = 600;
  for (let index = 0; index < pages.length - 1; index += 1) {
    let pageSize = pages[index].reduce((sum, unit) => sum + unitSize(unit), 0);
    while (pageSize < minimumTextSize && pages[index + 1].length > 0) {
      const nextUnit = pages[index + 1][0];
      const nextSize = unitSize(nextUnit);
      if (pageSize + nextSize > maximumTextSize) break;
      pages[index].push(pages[index + 1].shift());
      pageSize += nextSize;
    }
  }
}

function assignMediaSources(chapters) {
  const names = new Map();
  let number = 0;
  for (const chapter of chapters) {
    visitBlocks(chapter.blocks, (block) => {
      if (!["image", "video", "media"].includes(block.type)) return;
      if (!names.has(block.ref)) names.set(block.ref, stableName(block.ref, ++number));
      block.src = `assets/review-media/${names.get(block.ref)}`;
    });
  }
  return names;
}

export function parseReview(markdown) {
  const chapters = [];
  let chapter;
  let section;
  let paragraph = [];
  const flushParagraph = () => {
    if (!chapter || paragraph.length === 0) return;
    chapter.blocks.push(...blocksForParagraph(paragraph, section.title));
    paragraph = [];
  };

  const lines = String(markdown).replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const heading = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2];
      const slug = level === 2 ? chapterByTitle.get(title) : undefined;
      if (slug) {
        chapter = { slug, title, summary: "", sections: [], blocks: [] };
        chapters.push(chapter);
        section = { title, level, index: 0 };
        chapter.sections.push(section);
      } else if (chapter) {
        section = { title, level, index: chapter.blocks.length };
        chapter.sections.push(section);
        chapter.blocks.push({ type: "heading", text: title, level, section: title });
      }
    } else if (chapter && calloutStartPattern.test(line)) {
      flushParagraph();
      const quotedLines = [line];
      while (
        lineIndex + 1 < lines.length
        && /^\s*>/.test(lines[lineIndex + 1])
        && !calloutStartPattern.test(lines[lineIndex + 1])
      ) {
        quotedLines.push(lines[++lineIndex]);
      }
      chapter.blocks.push(calloutBlock(quotedLines, section.title));
    } else if (chapter && line.trim() === "") {
      flushParagraph();
    } else if (chapter) {
      paragraph.push(line);
    }
  }
  flushParagraph();

  assignMediaSources(chapters);
  for (const item of chapters) {
    const textParts = [];
    visitBlocks(item.blocks, (block) => {
      if (block.type === "text" || block.type === "heading") textParts.push(block.text);
    });
    const text = textParts.join("\n");
    item.summary = text.replace(/\s+/g, " ").slice(0, 160);
    item.characterCount = text.length;
    item.pages = paginateBlocks(item.blocks);
  }
  return { chapters };
}

function normalizeObsidianRef(ref) {
  return String(ref).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").toLowerCase();
}

function refBasename(ref) {
  return path.posix.basename(normalizeObsidianRef(ref));
}

function walkMedia(root, wantedRelativePaths, wantedBasenames, found = {
  byRelativePath: new Map(),
  byBasename: new Map(),
}, vaultRoot = root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkMedia(fullPath, wantedRelativePaths, wantedBasenames, found, vaultRoot);
      continue;
    }
    const relativePath = normalizeObsidianRef(path.relative(vaultRoot, fullPath));
    const basename = refBasename(relativePath);
    if (wantedRelativePaths.has(relativePath)) found.byRelativePath.set(relativePath, fullPath);
    if (wantedBasenames.has(basename)) {
      const candidates = found.byBasename.get(basename) || [];
      candidates.push({ fullPath, relativePath });
      found.byBasename.set(basename, candidates);
    }
  }
  return found;
}

function resolveMediaSources(uniqueRefs, found) {
  const sources = new Map();
  const missing = [];
  const ambiguous = [];
  for (const ref of uniqueRefs) {
    const normalized = normalizeObsidianRef(ref);
    if (normalized.includes("/")) {
      const source = found.byRelativePath.get(normalized);
      if (source) sources.set(ref, source);
      else missing.push(ref);
      continue;
    }
    const candidates = found.byBasename.get(refBasename(ref)) || [];
    if (candidates.length === 1) sources.set(ref, candidates[0].fullPath);
    else if (candidates.length === 0) missing.push(ref);
    else ambiguous.push(`${ref}: ${candidates.map((candidate) => candidate.relativePath).join(", ")}`);
  }
  if (missing.length > 0 || ambiguous.length > 0) {
    const issues = [];
    if (missing.length > 0) issues.push(`Missing review media: ${missing.join(", ")}`);
    if (ambiguous.length > 0) issues.push(`Ambiguous review media: ${ambiguous.join("; ")}`);
    throw new Error(issues.join(" | "));
  }
  return sources;
}

function isSameOrDescendant(candidate, ancestor) {
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  const normalizedAncestor = path.resolve(ancestor).toLowerCase();
  const boundary = normalizedAncestor.endsWith(path.sep) ? normalizedAncestor : `${normalizedAncestor}${path.sep}`;
  return normalizedCandidate === normalizedAncestor || normalizedCandidate.startsWith(boundary);
}

function pathsOverlap(left, right) {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function validateMediaOutputDirectory(mediaOutputDir, workspace, markdownPath, obsidianRoot, sourcePaths = []) {
  const resolvedMediaDir = path.resolve(mediaOutputDir);
  const root = path.parse(resolvedMediaDir).root;
  if (
    resolvedMediaDir.toLowerCase() === root.toLowerCase()
    || !isSameOrDescendant(resolvedMediaDir, workspace)
    || isSameOrDescendant(workspace, resolvedMediaDir)
    || pathsOverlap(resolvedMediaDir, markdownPath)
    || pathsOverlap(resolvedMediaDir, obsidianRoot)
    || sourcePaths.some((sourcePath) => pathsOverlap(resolvedMediaDir, sourcePath))
    || (fs.existsSync(resolvedMediaDir) && !fs.statSync(resolvedMediaDir).isDirectory())
  ) {
    throw new Error(`Unsafe media output directory: ${resolvedMediaDir}`);
  }
}

function validateReviewOutputPath(outputPath, workspace, mediaOutputDir, markdownPath, obsidianRoot, sourcePaths = []) {
  const resolvedOutputPath = path.resolve(outputPath);
  if (
    pathsOverlap(resolvedOutputPath, mediaOutputDir)
    || !isSameOrDescendant(resolvedOutputPath, workspace)
    || isSameOrDescendant(workspace, resolvedOutputPath)
    || pathsOverlap(resolvedOutputPath, markdownPath)
    || pathsOverlap(resolvedOutputPath, obsidianRoot)
    || sourcePaths.some((sourcePath) => pathsOverlap(resolvedOutputPath, sourcePath))
    || (fs.existsSync(resolvedOutputPath) && fs.statSync(resolvedOutputPath).isDirectory())
  ) {
    throw new Error(`Unsafe review output path: ${resolvedOutputPath}`);
  }
}

function temporarySibling(targetPath, label) {
  const directory = path.dirname(targetPath);
  const base = path.basename(targetPath);
  return path.join(directory, `.${base}.${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function preserveGeneratedAt(outputPath, payload) {
  try {
    const previous = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const { generatedAt: previousGeneratedAt, ...previousContent } = previous;
    const { generatedAt, ...nextContent } = payload;
    if (typeof previousGeneratedAt === "string" && JSON.stringify(previousContent) === JSON.stringify(nextContent)) {
      return { ...payload, generatedAt: previousGeneratedAt };
    }
  } catch {
    // A missing or malformed previous output must be replaced with a fresh payload.
  }
  return payload;
}

function serializedPayload(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function reviewOutputIsCurrent(outputPath, payload, mediaOutputDir, media, sources) {
  try {
    if (!fs.readFileSync(outputPath).equals(Buffer.from(serializedPayload(payload), "utf8"))) return false;
    const expected = new Set(media.map((block) => path.basename(block.src)));
    const local = fs.readdirSync(mediaOutputDir, { withFileTypes: true }).filter((entry) => entry.isFile());
    if (local.length !== expected.size || local.some((entry) => !expected.has(entry.name))) return false;
    const copiedRefs = new Set();
    return media.every((block) => {
      if (copiedRefs.has(block.ref)) return true;
      copiedRefs.add(block.ref);
      const localPath = path.join(mediaOutputDir, path.basename(block.src));
      return fs.existsSync(localPath) && fs.readFileSync(localPath).equals(fs.readFileSync(sources.get(block.ref)));
    });
  } catch {
    return false;
  }
}

function cleanupAfterPromotion(targetPath, options, operations, warnings) {
  const remove = operations.remove || fs.rmSync;
  const onCleanupWarning = operations.onCleanupWarning || (() => {});
  const sleep = operations.sleep || (() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      remove(targetPath, { ...options, maxRetries: 6, retryDelay: 50 });
      return true;
    } catch (error) {
      const warning = new Error(`Review backup cleanup attempt ${attempt} failed for ${targetPath}: ${error.message}`);
      warnings.push(warning); onCleanupWarning(warning);
      if (attempt < 3) sleep();
    }
  }
  return false;
}

export function replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath }, operations = {}) {
  const mediaBackup = temporarySibling(mediaOutputDir, "backup");
  const outputBackup = temporarySibling(outputPath, "backup");
  let mediaBackedUp = false;
  let mediaPromoted = false;
  let outputBackedUp = false;
  let outputPromoted = false;

  try {
    if (fs.existsSync(mediaOutputDir)) {
      fs.renameSync(mediaOutputDir, mediaBackup);
      mediaBackedUp = true;
    }
    fs.renameSync(temporaryMediaDir, mediaOutputDir);
    mediaPromoted = true;
    if (fs.existsSync(outputPath)) {
      fs.renameSync(outputPath, outputBackup);
      outputBackedUp = true;
    }
    fs.renameSync(temporaryOutputPath, outputPath);
    outputPromoted = true;
  } catch (error) {
    if (outputPromoted) fs.rmSync(outputPath, { force: true });
    if (outputBackedUp) fs.renameSync(outputBackup, outputPath);
    if (mediaPromoted) fs.rmSync(mediaOutputDir, { recursive: true, force: true });
    if (mediaBackedUp) fs.renameSync(mediaBackup, mediaOutputDir);
    throw error;
  }

  const warnings = [];
  if (mediaBackedUp) cleanupAfterPromotion(mediaBackup, { recursive: true, force: true }, operations, warnings);
  if (outputBackedUp) cleanupAfterPromotion(outputBackup, { force: true }, operations, warnings);
  return { cleanupWarnings: warnings };
}

function reviewMedia(review) {
  const media = [];
  for (const chapter of review.chapters) {
    visitBlocks(chapter.blocks, (block) => {
      if (["image", "video", "media"].includes(block.type)) media.push(block);
    });
  }
  return media;
}

export function writeReviewData(options = {}) {
  const workspace = options.workspace || process.cwd();
  const markdownPath = options.markdownPath || reviewMarkdownDefault;
  const obsidianRoot = options.obsidianRoot || obsidianRootDefault;
  const outputPath = options.outputPath || path.join(workspace, "data", "review.json");
  const mediaOutputDir = options.mediaOutputDir || path.join(workspace, "assets", "review-media");
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const copyFile = options.copyFile || fs.copyFileSync;
  const clock = options.clock || (() => new Date());
  validateMediaOutputDirectory(mediaOutputDir, workspace, markdownPath, obsidianRoot);
  validateReviewOutputPath(outputPath, workspace, mediaOutputDir, markdownPath, obsidianRoot);
  const review = parseReview(fs.readFileSync(markdownPath, "utf8"));
  const media = reviewMedia(review);
  const uniqueRefs = [...new Set(media.map((block) => block.ref))];
  const wantedRelativePaths = new Set(uniqueRefs.map(normalizeObsidianRef).filter((ref) => ref.includes("/")));
  const wantedNames = new Set(uniqueRefs.map(refBasename));
  onProgress("parsed", { chapters: review.chapters.length, mediaEmbeds: media.length });
  onProgress("indexing-media", { wantedAssets: wantedNames.size, obsidianRoot });
  const found = walkMedia(obsidianRoot, wantedRelativePaths, wantedNames);
  const sources = resolveMediaSources(uniqueRefs, found);
  validateMediaOutputDirectory(mediaOutputDir, workspace, markdownPath, obsidianRoot, [...sources.values()]);
  validateReviewOutputPath(outputPath, workspace, mediaOutputDir, markdownPath, obsidianRoot, [...sources.values()]);
  const generatedAt = clock().toISOString();
  let payload = preserveGeneratedAt(outputPath, { generatedAt, chapters: review.chapters });
  if (payload.generatedAt !== generatedAt && !reviewOutputIsCurrent(outputPath, payload, mediaOutputDir, media, sources)) {
    payload = { ...payload, generatedAt };
  }

  if (reviewOutputIsCurrent(outputPath, payload, mediaOutputDir, media, sources)) {
    onProgress("written", { outputPath, reusedMedia: uniqueRefs.length });
    return payload;
  }

  onProgress("copying-media", { uniqueAssets: uniqueRefs.length, mediaOutputDir });
  const temporaryMediaDir = temporarySibling(mediaOutputDir, "tmp");
  const temporaryOutputPath = temporarySibling(outputPath, "tmp");
  try {
    fs.mkdirSync(temporaryMediaDir, { recursive: true });
    const copied = new Set();
    for (const block of media) {
      if (copied.has(block.ref)) continue;
      copyFile(sources.get(block.ref), path.join(temporaryMediaDir, path.basename(block.src)));
      copied.add(block.ref);
    }
    if (copied.size !== uniqueRefs.length || fs.readdirSync(temporaryMediaDir).length !== uniqueRefs.length) {
      throw new Error(`Copied review media count mismatch: expected ${uniqueRefs.length}, got ${copied.size}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(temporaryOutputPath, serializedPayload(payload), "utf8");
    const replacement = replaceOutputs(
      { mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath },
      options.promotionOperations || {},
    );
    for (const warning of replacement.cleanupWarnings) {
      onProgress("cleanup-warning", { message: warning.message });
    }
    onProgress("written", { outputPath });
    return payload;
  } catch (error) {
    fs.rmSync(temporaryMediaDir, { recursive: true, force: true });
    fs.rmSync(temporaryOutputPath, { force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const review = writeReviewData({
    onProgress(stage, details) {
      console.error(`[review-data] ${stage} ${JSON.stringify(details)}`);
    },
  });
  const media = reviewMedia(review);
  console.log(JSON.stringify({
    chapters: review.chapters.length,
    pages: review.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0),
    mediaEmbeds: media.length,
    images: media.filter((block) => block.type === "image").length,
    videos: media.filter((block) => block.type === "video").length,
    uniqueMedia: new Set(media.map((block) => block.ref)).size,
  }));
}
