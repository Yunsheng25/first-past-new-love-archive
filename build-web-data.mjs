import fs from "node:fs";
import path from "node:path";
import { buildRecords, imageRefs, slugForImage, summarize } from "./web-data-utils.mjs";

const workspace = process.cwd();
const canvasPath = path.join(workspace, "output", "canvas-raw.json");
const outputPath = path.join(workspace, "canvas-data.json");
const jsOutputPath = path.join(workspace, "canvas-data.js");
const imageOutputDir = path.join(workspace, "assets", "canvas-images");
const obsidianRoot = "D:\\黑曜石";

const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
const refs = [
  ...new Set(
    (canvas.nodes || [])
      .filter((node) => node.type === "text")
      .flatMap((node) => imageRefs(node.text || "")),
  ),
];
const names = new Set(refs.map((ref) => path.win32.basename(ref)));

function walkImages(dir, found = new Map()) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkImages(fullPath, found);
    } else if (names.has(entry.name) && !found.has(entry.name)) {
      found.set(entry.name, fullPath);
    }
  }
  return found;
}

const foundByName = walkImages(obsidianRoot);
const imageMap = new Map(refs.map((ref) => [ref, foundByName.get(path.win32.basename(ref)) || ""]));
const records = buildRecords(canvas, imageMap);

fs.rmSync(imageOutputDir, { recursive: true, force: true });
fs.mkdirSync(imageOutputDir, { recursive: true });

let imageNumber = 0;
for (const record of records) {
  for (const image of record.images) {
    imageNumber += 1;
    const expectedSrc = `assets/canvas-images/${slugForImage(image.ref, imageNumber)}`;
    image.src = expectedSrc;
    if (image.originalPath && fs.existsSync(image.originalPath)) {
      fs.copyFileSync(image.originalPath, path.join(workspace, expectedSrc));
      image.available = true;
    } else {
      image.available = false;
    }
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  summary: summarize(records, canvas),
  phases: [
    "现实开场 / 老年相遇",
    "校园回忆",
    "商场 / 试衣间 / 钢琴",
    "婚礼",
    "医院",
    "梦醒寻找 / 空场",
    "其他未分类",
  ],
  records,
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
fs.writeFileSync(
  jsOutputPath,
  `window.CANVAS_ARCHIVE_DATA = ${JSON.stringify(payload, null, 2)};\n`,
  "utf8",
);
console.log(JSON.stringify(payload.summary, null, 2));
