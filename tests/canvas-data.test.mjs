import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const canvasPath = "D:/黑曜石/canvas白板/《初恋旧爱新欢》视频制作.canvas";
const utils = await import("../scripts/web-data-utils.mjs").catch(() => ({}));
const independentValidEmbedPattern = /!\[\[([^\]\r\n]+?)\]\]/g;
const independentMalformedImagePattern = /!\[\[([^\]\r\n]+?\.(?:png|jpe?g|webp|gif|bmp|svg))\](?!\])/gi;

function independentlyParsedImageRefs(text = "") {
  return [...String(text).matchAll(independentValidEmbedPattern)]
    .map((match) => match[1].split("|")[0].trim().replace(/\\/g, "/"))
    .filter((ref) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(ref));
}

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
    图生视频: 25,
    剪辑参考: 1,
    转场: 1,
    生图: 1,
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

test("marks only nodes geometrically contained by authored error groups without changing visual order", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const canvas = {
    nodes: [
      { id: "face-group", type: "group", label: "出现人脸", x: 0, y: 0, width: 200, height: 200 },
      { id: "character-group", type: "group", label: "人物呈现的形象特征与前方不符", x: 300, y: 0, width: 200, height: 200 },
      { id: "inside-face", type: "text", text: "![[face.png]]", x: 10, y: 10, width: 40, height: 40 },
      { id: "boundary-character", type: "text", text: "![[character.png]]", x: 450, y: 50, width: 100, height: 100 },
      { id: "outside", type: "text", text: "![[normal.png]]", x: 600, y: 0, width: 100, height: 100 },
    ],
    edges: [],
  };
  const result = parseCanvasArchive(canvas);
  const byId = new Map(result.cases.map((item) => [item.source.nodeId, item]));

  assert.equal(byId.get("inside-face").status, "error");
  assert.equal(byId.get("inside-face").errorGroup, "出现人脸");
  assert.equal(byId.get("inside-face").errorReason, "出现人脸");
  assert.equal(byId.get("boundary-character").status, "error");
  assert.equal(byId.get("boundary-character").errorGroup, "人物呈现的形象特征与前方不符");
  assert.equal(byId.get("outside").status, "normal");
  assert.equal(byId.get("outside").errorGroup, null);
  assert.equal(byId.get("outside").errorReason, null);
  assert.deepEqual(result.cases.map((item) => item.source.nodeId), ["outside", "inside-face", "boundary-character"]);
});

test("uses a stable authored priority when a node belongs to both error groups", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const canvas = {
    nodes: [
      { id: "character-group", type: "group", label: "人物呈现的形象特征与前方不符", x: 0, y: 0, width: 300, height: 300 },
      { id: "face-group", type: "group", label: "出现人脸", x: 50, y: 50, width: 200, height: 200 },
      { id: "nested", type: "text", text: "![[nested.png]]", x: 100, y: 100, width: 50, height: 50 },
    ],
    edges: [],
  };

  const item = parseCanvasArchive(canvas).cases[0];
  assert.equal(item.errorGroup, "出现人脸");
  assert.deepEqual(item.source.groups.map((group) => group.id), ["character-group", "face-group"]);
});

test("preserves the exact prompt-to-image mapping and duplicate occurrences", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const archive = parseCanvasArchive(raw);
  const orderedNodes = raw.nodes
    .filter((node) => node.type === "text")
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  const sourceSequence = orderedNodes.flatMap((node) => independentlyParsedImageRefs(node.text || ""));
  const archiveSequence = archive.cases.flatMap((item) => item.images.map((image) => image.originalRef));

  assert.deepEqual(archiveSequence, sourceSequence);
  assert.deepEqual(
    archive.cases.map((item) => item.prompt),
    orderedNodes.map((node) => String(node.text || "").replace(independentValidEmbedPattern, (embed, rawRef) => (
      /\.(png|jpe?g|webp|gif|bmp|svg)(?:\|.*)?$/i.test(rawRef.trim()) ? "" : embed
    )).replace(independentMalformedImagePattern, "").trim()),
  );
  const repeated = archive.cases.flatMap((item) => item.images).filter((image) => image.originalRef === "18.png");
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].src, repeated[1].src, "duplicate occurrences should reuse one physical asset");
});

test("cleans the known malformed case-04 embed from display text without counting or rewriting it", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const sourceNode = raw.nodes.find((node) => node.id === "a538b7cf85a1fb5e");
  const malformed = [...sourceNode.text.matchAll(independentMalformedImagePattern)];
  const validRefs = independentlyParsedImageRefs(sourceNode.text);
  const item = parseCanvasArchive(raw).cases.find((candidate) => candidate.source.nodeId === sourceNode.id);

  assert.equal(malformed.length, 1, "source sentinel must keep exactly one malformed image embed");
  assert.equal(validRefs.length, 2, "the malformed source text must not become a 139th occurrence");
  assert.deepEqual(item.images.map((image) => image.originalRef), validRefs);
  assert.ok(item.rawText.includes(malformed[0][0]), "rawText remains an exact audit trail");
  assert.ok(!item.prompt.includes(malformed[0][0]), "display prompt removes malformed markup");
  assert.equal(item.uncertain, true);
  assert.ok(item.uncertainReasons.includes("非标准图片嵌入已从展示文字清理"));
});

test("classifies known source sentinels by semantic wording instead of case ids", () => {
  const parseCanvasArchive = required("parseCanvasArchive");
  const raw = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const byId = new Map(parseCanvasArchive(raw).cases.map((item) => [item.id, item]));

  assert.match(byId.get("case-62").prompt, /开始时.*随后.*整个过程/s);
  assert.equal(byId.get("case-62").type, "图生视频");
  assert.match(byId.get("case-32").prompt, /老人.*牵上手/s);
  assert.equal(byId.get("case-32").stage, "雨夜小区");
  assert.match(byId.get("case-34").prompt, /商城/);
  assert.equal(byId.get("case-34").stage, "商场");
  assert.match(byId.get("case-36").prompt, /店铺/);
  assert.equal(byId.get("case-36").stage, "商场");
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
