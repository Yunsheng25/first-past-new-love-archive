import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const canvasPath = "D:/黑曜石/canvas白板/《初恋旧爱新欢》视频制作.canvas";
const utils = await import("../scripts/web-data-utils.mjs").catch(() => ({}));

function required(name) {
  assert.equal(typeof utils[name], "function", `${name} must be exported`);
  return utils[name];
}

test("extracts image embeds without changing their authored order", () => {
  const imageRefs = required("imageRefs");
  const stripEmbeds = required("stripEmbeds");
  const text = "![[frames/首帧.png|400]]文字甲![[尾帧.jpg]]文字乙![[说明.md]]";

  assert.deepEqual(imageRefs(text), ["frames/首帧.png", "尾帧.jpg"]);
  assert.equal(stripEmbeds(text), "文字甲文字乙![[说明.md]]");
});

test("classifies all five archive prompt types in readable Chinese", () => {
  const classifyPromptType = required("classifyPromptType");

  assert.equal(classifyPromptType("以图一为首帧、图二为尾帧", 2), "首尾帧");
  assert.equal(classifyPromptType("让两个画面自然叠化转场", 2), "转场");
  assert.equal(classifyPromptType("使用这张图生成一段视频，镜头缓慢抬起", 1), "图生视频");
  assert.equal(classifyPromptType("保留黑场和音乐，作为剪辑参考", 4), "剪辑参考");
  assert.equal(classifyPromptType("视频提示词：镜头缓慢抬起，配音音效只要脚步声", 1), "图生视频");
  assert.equal(classifyPromptType("低饱和水彩纸张质感", 1), "生图");
});

test("parses the real canvas into stable coordinate-ordered cases", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const archive = parseCanvasArchive(raw);

  assert.equal(archive.cases.length, 72);
  assert.equal(archive.summary.imageOccurrences, 138);
  assert.equal(archive.summary.uniqueImages, 137);
  assert.deepEqual(archive.summary.types.sort(), ["剪辑参考", "图生视频", "生图", "转场", "首尾帧"].sort());
  assert.deepEqual(archive.summary.typeCounts, {
    首尾帧: 44,
    图生视频: 24,
    剪辑参考: 1,
    转场: 1,
    生图: 2,
  });
  assert.equal(archive.cases[0].id, "case-01");
  assert.equal(archive.cases[0].source.nodeId, "e03bad1e478b6346");
  assert.deepEqual(archive.cases[0].source.position, { x: -600, y: -1640 });
  assert.equal(archive.cases[1].stage, "钢琴与回忆", "a ring detail alone must not turn the mirror-and-piano scene into a wedding");
  assert.equal(archive.cases.at(-1).id, "case-72");
  assert.equal(archive.cases.at(-1).source.nodeId, "aaffe5e9fad7dd31");
  assert.deepEqual(archive.cases.at(-1).source.position, { x: 1600, y: 10651 });
  assert.ok(archive.cases.every((item, index) => item.id === `case-${String(index + 1).padStart(2, "0")}`));
});

test("preserves the exact prompt-to-image mapping and duplicate occurrences", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const imageRefs = required("imageRefs");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const archive = parseCanvasArchive(raw);
  const orderedNodes = raw.nodes
    .filter((node) => node.type === "text")
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  const sourceSequence = orderedNodes.flatMap((node) => imageRefs(node.text || ""));
  const archiveSequence = archive.cases.flatMap((item) => item.images.map((image) => image.originalRef));

  assert.deepEqual(archiveSequence, sourceSequence);
  assert.deepEqual(
    archive.cases.map((item) => item.prompt),
    orderedNodes.map((node) => utils.stripEmbeds(node.text || "")),
  );
  const repeated = archive.cases.flatMap((item) => item.images).filter((image) => image.originalRef === "18.png");
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].src, repeated[1].src, "duplicate occurrences should reuse one physical asset");
});

test("emits readable UTF-8 metadata and useful story stages", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const archive = parseCanvasArchive(raw);
  const serialized = JSON.stringify(archive);

  assert.ok(!serialized.includes("\uFFFD"));
  assert.ok(!serialized.includes("锟斤拷"));
  assert.ok(archive.cases.some((item) => item.stage === "婚礼"));
  assert.ok(archive.cases.some((item) => item.stage === "病房"));
  assert.ok(archive.cases.some((item) => item.stage === "雨夜小区"));
  assert.ok(archive.cases.every((item) => item.title && item.type && item.stage));
});
