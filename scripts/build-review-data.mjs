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

function blocksForParagraph(paragraph, section) {
  const text = paragraph.map((line) => line.replace(/^\s*>\s?/, "")).join("\n");
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

function blockSize(block) {
  return block.type === "text" || block.type === "heading" ? block.text.length : 0;
}

export function paginateBlocks(blocks, limit = 900) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const pages = [];
  let page = [];
  let pageSize = 0;
  for (const block of blocks) {
    const size = blockSize(block);
    if (page.length > 0 && pageSize + size > limit) {
      pages.push(page);
      page = [];
      pageSize = 0;
    }
    page.push(block);
    pageSize += size;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function assignMediaSources(chapters) {
  const names = new Map();
  let number = 0;
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (!["image", "video", "media"].includes(block.type)) continue;
      if (!names.has(block.ref)) names.set(block.ref, stableName(block.ref, ++number));
      block.src = `assets/review-media/${names.get(block.ref)}`;
    }
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

  for (const line of String(markdown).replace(/^\uFEFF/, "").split(/\r?\n/)) {
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
    } else if (chapter && line.trim() === "") {
      flushParagraph();
    } else if (chapter) {
      paragraph.push(line);
    }
  }
  flushParagraph();

  assignMediaSources(chapters);
  for (const item of chapters) {
    const text = item.blocks
      .filter((block) => block.type === "text" || block.type === "heading")
      .map((block) => block.text)
      .join("\n");
    item.summary = text.replace(/\s+/g, " ").slice(0, 160);
    item.characterCount = text.length;
    item.pages = paginateBlocks(item.blocks);
  }
  return { chapters };
}

function walkMedia(root, wantedNames, found = new Map()) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.size === wantedNames.size) break;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) walkMedia(fullPath, wantedNames, found);
    else if (wantedNames.has(entry.name.toLowerCase()) && !found.has(entry.name.toLowerCase())) found.set(entry.name.toLowerCase(), fullPath);
  }
  return found;
}

function reviewMedia(review) {
  return review.chapters.flatMap((chapter) => chapter.blocks.filter((block) => ["image", "video", "media"].includes(block.type)));
}

export function writeReviewData(options = {}) {
  const workspace = options.workspace || process.cwd();
  const markdownPath = options.markdownPath || reviewMarkdownDefault;
  const obsidianRoot = options.obsidianRoot || obsidianRootDefault;
  const outputPath = options.outputPath || path.join(workspace, "data", "review.json");
  const mediaOutputDir = options.mediaOutputDir || path.join(workspace, "assets", "review-media");
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const review = parseReview(fs.readFileSync(markdownPath, "utf8"));
  const media = reviewMedia(review);
  const uniqueRefs = [...new Set(media.map((block) => block.ref))];
  const wantedNames = new Set(uniqueRefs.map((ref) => path.win32.basename(ref).toLowerCase()));
  onProgress("parsed", { chapters: review.chapters.length, mediaEmbeds: media.length });
  onProgress("indexing-media", { wantedAssets: wantedNames.size, obsidianRoot });
  const found = walkMedia(obsidianRoot, wantedNames);
  const missing = uniqueRefs.filter((ref) => !found.has(path.win32.basename(ref).toLowerCase()));
  if (missing.length > 0) throw new Error(`Missing review media: ${missing.join(", ")}`);

  onProgress("copying-media", { uniqueAssets: uniqueRefs.length, mediaOutputDir });
  fs.rmSync(mediaOutputDir, { recursive: true, force: true });
  fs.mkdirSync(mediaOutputDir, { recursive: true });
  const copied = new Set();
  for (const block of media) {
    if (copied.has(block.ref)) continue;
    fs.copyFileSync(found.get(path.win32.basename(block.ref).toLowerCase()), path.join(mediaOutputDir, path.basename(block.src)));
    copied.add(block.ref);
  }

  const payload = { generatedAt: new Date().toISOString(), chapters: review.chapters };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  onProgress("written", { outputPath });
  return payload;
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
