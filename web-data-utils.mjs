const embedPattern = /!\[\[([^\]]+)\]\]/g;
const imageExtensionPattern = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

export function imageRefs(text = "") {
  return [...text.matchAll(embedPattern)]
    .map((match) => match[1].split("|")[0])
    .filter((ref) => imageExtensionPattern.test(ref));
}

export function stripEmbeds(text = "") {
  return text.replace(embedPattern, "").trim();
}

export function slugForImage(ref, index) {
  const normalized = ref
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${String(index).padStart(3, "0")}-${normalized || "image.png"}`;
}

export function classifyPhase(node, prompt, refs = []) {
  const text = `${prompt || ""} ${refs.join(" ")}`;
  const y = node?.y ?? 0;
  if (["病房", "病床", "医院", "空床"].some((keyword) => text.includes(keyword))) return "医院";
  if (["婚礼", "婚纱", "新娘", "戒指", "教堂", "拥抱"].some((keyword) => text.includes(keyword))) return "婚礼";
  if (["教室", "课本", "棒棒糖", "窗户", "校园"].some((keyword) => text.includes(keyword))) return "校园回忆";
  if (["空荡", "空无", "没有任何人", "没人", "寻找", "落空"].some((keyword) => text.includes(keyword)) && y >= 8000) {
    return "梦醒寻找 / 空场";
  }
  if (["小区", "老人", "雨夜", "夜晚", "湿润路面"].some((keyword) => text.includes(keyword))) return "现实开场 / 老年相遇";
  if (["钢琴", "电子琴", "服装店", "试衣间", "商场", "帘子", "店铺", "婚纱店"].some((keyword) => text.includes(keyword))) {
    return "商场 / 试衣间 / 钢琴";
  }
  return "其他未分类";
}

function center(node) {
  return {
    x: (node.x ?? 0) + (node.width ?? 0) / 2,
    y: (node.y ?? 0) + (node.height ?? 0) / 2,
  };
}

function visualKey(node) {
  return [node.y ?? 0, node.x ?? 0, node.id ?? ""];
}

function compareVisual(a, b) {
  const left = visualKey(a);
  const right = visualKey(b);
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
}

function topologicalVisualOrder(textNodes, edges) {
  const byId = new Map(textNodes.map((node) => [node.id, node]));
  const indegree = new Map(textNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(textNodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (!byId.has(edge.fromNode) || !byId.has(edge.toNode)) continue;
    indegree.set(edge.toNode, indegree.get(edge.toNode) + 1);
    outgoing.get(edge.fromNode).push(edge);
  }

  const queue = textNodes.filter((node) => indegree.get(node.id) === 0).sort(compareVisual);
  const ordered = [];
  const seen = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);

    for (const edge of outgoing.get(node.id).sort((a, b) => compareVisual(byId.get(a.toNode), byId.get(b.toNode)))) {
      indegree.set(edge.toNode, indegree.get(edge.toNode) - 1);
      if (indegree.get(edge.toNode) === 0) {
        queue.push(byId.get(edge.toNode));
        queue.sort(compareVisual);
      }
    }
  }

  for (const node of [...textNodes].sort(compareVisual)) {
    if (!seen.has(node.id)) ordered.push(node);
  }

  return ordered;
}

function nodeGroups(node, groupNodes) {
  const point = center(node);
  return groupNodes
    .filter((group) => (
      point.x >= (group.x ?? 0)
      && point.x <= (group.x ?? 0) + (group.width ?? 0)
      && point.y >= (group.y ?? 0)
      && point.y <= (group.y ?? 0) + (group.height ?? 0)
    ))
    .map((group) => group.label || group.id);
}

function nearestNodes(node, textNodes, limit = 3) {
  const point = center(node);
  return textNodes
    .filter((candidate) => candidate.id !== node.id)
    .map((candidate) => {
      const candidatePoint = center(candidate);
      return {
        id: candidate.id,
        x: candidate.x,
        y: candidate.y,
        firstImage: imageRefs(candidate.text || "")[0] || "",
        distance: Math.round(Math.hypot(point.x - candidatePoint.x, point.y - candidatePoint.y)),
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function connectionRows(nodeId, nodesById, edges) {
  return edges
    .filter((edge) => edge.fromNode === nodeId || edge.toNode === nodeId)
    .map((edge) => {
      const direction = edge.toNode === nodeId ? "入线" : "出线";
      const otherId = edge.toNode === nodeId ? edge.fromNode : edge.toNode;
      const other = nodesById.get(otherId);
      return {
        id: edge.id,
        direction,
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        fromSide: edge.fromSide,
        toSide: edge.toSide,
        otherFirstImage: other ? imageRefs(other.text || "")[0] || "" : "",
      };
    });
}

export function buildRecords(canvas, imageMap = new Map()) {
  const nodes = canvas.nodes || [];
  const edges = canvas.edges || [];
  const textNodes = nodes.filter((node) => node.type === "text");
  const groupNodes = nodes.filter((node) => node.type === "group");
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const ordered = topologicalVisualOrder(textNodes, edges);
  let imageNumber = 0;

  return ordered
    .map((node) => {
      const refs = imageRefs(node.text || "");
      if (!refs.length) return null;
      const prompt = stripEmbeds(node.text || "");
      const phase = classifyPhase(node, prompt, refs);
      return {
        id: node.id,
        index: 0,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        phase,
        prompt,
        rawText: node.text || "",
        uncertain: !prompt,
        groups: nodeGroups(node, groupNodes),
        images: refs.map((ref) => {
          imageNumber += 1;
          const originalPath = imageMap.get(ref) || "";
          return {
            ref,
            originalPath,
            src: `assets/canvas-images/${slugForImage(ref, imageNumber)}`,
          };
        }),
        connections: connectionRows(node.id, nodesById, edges),
        nearest: nearestNodes(node, textNodes),
      };
    })
    .filter(Boolean)
    .map((record, index) => ({ ...record, index: index + 1 }));
}

export function summarize(records, canvas) {
  const phaseCounts = {};
  for (const record of records) {
    phaseCounts[record.phase] = (phaseCounts[record.phase] || 0) + 1;
  }
  return {
    nodes: canvas.nodes?.length || 0,
    edges: canvas.edges?.length || 0,
    textNodes: canvas.nodes?.filter((node) => node.type === "text").length || 0,
    fileNodes: canvas.nodes?.filter((node) => node.type === "file").length || 0,
    imageRefs: records.reduce((sum, record) => sum + record.images.length, 0),
    uniqueImageRefs: new Set(records.flatMap((record) => record.images.map((image) => image.ref))).size,
    groups: records.length,
    certain: records.filter((record) => !record.uncertain).length,
    uncertain: records.filter((record) => record.uncertain).length,
    phaseCounts,
  };
}
