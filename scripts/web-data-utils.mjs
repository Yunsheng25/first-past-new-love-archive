import path from "node:path";

const embedPattern = /!\[\[([^\]]+)\]\]/g;
const imageExtensionPattern = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const malformedImageEmbedPattern = /!\[\[([^\]\r\n]+?\.(?:png|jpe?g|webp|gif|bmp|svg))\](?!\])/gi;

function cleanRef(rawRef) {
  return String(rawRef).split("|")[0].trim().replace(/\\/g, "/");
}

export function imageRefs(text = "") {
  return [...String(text).matchAll(embedPattern)]
    .map((match) => cleanRef(match[1]))
    .filter((ref) => imageExtensionPattern.test(ref));
}

export function stripEmbeds(text = "") {
  return String(text)
    .replace(embedPattern, (embed, rawRef) => (imageExtensionPattern.test(cleanRef(rawRef)) ? "" : embed))
    .replace(malformedImageEmbedPattern, "")
    .trim();
}

function malformedImageEmbeds(text = "") {
  return [...String(text).matchAll(malformedImageEmbedPattern)].map((match) => match[0]);
}

export function classifyPromptType(prompt = "", imageCount = 0) {
  const text = String(prompt).trim();
  if (!text) return "剪辑参考";
  if (/这张图不是重画场景|调整.{0,20}(?:画面|视线|主体)/s.test(text)) return "生图";
  if (imageCount >= 2 && /首帧|尾帧/.test(text)) return "首尾帧";
  if (/转场|叠化|淡入|淡出/.test(text)) return "转场";
  if (/图生视频|生成.*视频|视频提示词|视频开始|镜头|动作要求/.test(text)) return "图生视频";
  if (/(?:开始时|开头).*(?:随后|然后|最终|最后)|整个过程|动作(?:放缓|连贯|自然)/s.test(text)) return "图生视频";
  if (/剪辑|黑场|配乐|音乐|音效/.test(text)) return "剪辑参考";
  return "生图";
}

export function classifyStage(prompt = "", refs = []) {
  const text = `${prompt} ${refs.join(" ")}`;
  if (/病房|医院|病床|病号服|医院走廊/.test(text)) return "病房";
  if (/婚礼|婚纱|教堂|新娘/.test(text)) return "婚礼";
  if (/服装店|试衣间|商场|商城|店铺|电子琴|帘子/.test(text)) return "商场";
  if (/教室|课本|棒棒糖|校园|录像机/.test(text)) return "校园回忆";
  if (/小区|雨夜|湿润路面|楼栋|老人.*(?:牵|相握|提着包)|(?:牵|相握).*老人/s.test(text)) return "雨夜小区";
  if (/钢琴|琴谱|镜子|领口|领带|老人/.test(text)) return "钢琴与回忆";
  if (/餐桌|吃饭|饭碗|筷子|孩子/.test(text)) return "家庭生活";
  if (/办公桌|电脑|键盘|办公室/.test(text)) return "办公室";
  return "其他场景";
}

function compareVisual(left, right) {
  return (left.y ?? 0) - (right.y ?? 0)
    || (left.x ?? 0) - (right.x ?? 0)
    || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function safeAssetName(ref, index) {
  const basename = path.posix.basename(cleanRef(ref));
  const extension = path.extname(basename).toLowerCase() || ".png";
  const stem = basename.slice(0, basename.length - extension.length)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "image";
  return `${String(index).padStart(3, "0")}-${stem}${extension}`;
}

function groupIdsForNode(node, groups) {
  const centerX = (node.x ?? 0) + (node.width ?? 0) / 2;
  const centerY = (node.y ?? 0) + (node.height ?? 0) / 2;
  return groups
    .filter((group) => centerX >= (group.x ?? 0)
      && centerX <= (group.x ?? 0) + (group.width ?? 0)
      && centerY >= (group.y ?? 0)
      && centerY <= (group.y ?? 0) + (group.height ?? 0))
    .map((group) => ({ id: group.id, label: group.label || "" }));
}

function imageRole(type, index, count) {
  if ((type === "首尾帧" || type === "转场") && count === 2) return index === 0 ? "首帧" : "尾帧";
  return `图 ${index + 1}`;
}

export function parseCanvasArchive(canvas) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
  const groups = nodes.filter((node) => node.type === "group");
  const orderedNodes = nodes
    .filter((node) => node.type === "text" && imageRefs(node.text || "").length > 0)
    .sort(compareVisual);
  const uniqueRefs = [];
  const seenRefs = new Set();
  for (const node of orderedNodes) {
    for (const ref of imageRefs(node.text || "")) {
      if (!seenRefs.has(ref)) {
        seenRefs.add(ref);
        uniqueRefs.push(ref);
      }
    }
  }
  const srcByRef = new Map(uniqueRefs.map((ref, index) => [
    ref,
    `assets/canvas-images/${safeAssetName(ref, index + 1)}`,
  ]));

  const cases = orderedNodes.map((node, caseIndex) => {
    const refs = imageRefs(node.text || "");
    const malformedEmbeds = malformedImageEmbeds(node.text || "");
    const prompt = stripEmbeds(node.text || "");
    const type = classifyPromptType(prompt, refs.length);
    const stage = classifyStage(prompt, refs);
    const id = `case-${String(caseIndex + 1).padStart(2, "0")}`;
    const uncertainReasons = [];
    if (!prompt) uncertainReasons.push("源节点没有提示词");
    if (malformedEmbeds.length > 0) uncertainReasons.push("非标准图片嵌入已从展示文字清理");
    return {
      id,
      index: caseIndex + 1,
      title: `${stage} · ${type}`,
      type,
      stage,
      tags: [...new Set([stage, type])],
      prompt,
      rawText: node.text || "",
      uncertain: uncertainReasons.length > 0,
      uncertainReasons,
      images: refs.map((ref, imageIndex) => ({
        occurrence: imageIndex + 1,
        originalRef: ref,
        src: srcByRef.get(ref),
        role: imageRole(type, imageIndex, refs.length),
      })),
      source: {
        nodeId: node.id,
        position: { x: node.x ?? 0, y: node.y ?? 0 },
        size: { width: node.width ?? 0, height: node.height ?? 0 },
        groups: groupIdsForNode(node, groups),
      },
    };
  });
  const typeCounts = {};
  const stageCounts = {};
  for (const item of cases) {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    stageCounts[item.stage] = (stageCounts[item.stage] || 0) + 1;
  }

  return {
    summary: {
      cases: cases.length,
      imageOccurrences: cases.reduce((sum, item) => sum + item.images.length, 0),
      uniqueImages: uniqueRefs.length,
      missingImages: null,
      types: Object.keys(typeCounts),
      typeCounts,
      stageCounts,
      visualOrder: "y, x, nodeId",
    },
    cases,
  };
}

export function slugForImage(ref, index) {
  return safeAssetName(ref, index);
}
