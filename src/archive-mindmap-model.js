export const MINDMAP_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'category-visual', title: '视觉方向探索', types: ['生图', '剪辑参考'] }),
  Object.freeze({ id: 'category-people', title: '人物与场景', types: ['图生视频'] }),
  Object.freeze({ id: 'category-errors', title: '错误案例与修正', error: true }),
  Object.freeze({ id: 'category-motion', title: '首尾帧与动态', types: ['首尾帧', '转场'] }),
]);

function categoryFor(record) {
  if (record.status === 'error') return MINDMAP_CATEGORIES[2];
  return MINDMAP_CATEGORIES.find((category) => category.types?.includes(record.type))
    ?? MINDMAP_CATEGORIES[1];
}

export function buildCategorizedMindmapRecords(records = []) {
  const orderedCases = [...records].sort((a, b) => a.index - b.index);
  const groups = new Map(MINDMAP_CATEGORIES.map((category) => [category.id, []]));
  orderedCases.forEach((record) => groups.get(categoryFor(record).id).push(record));

  const categories = MINDMAP_CATEGORIES.map((category, index) => {
    const children = groups.get(category.id);
    return {
      ...category,
      index: -(MINDMAP_CATEGORIES.length - index),
      isCategory: true,
      connections: children[0] ? [{ direction: '出线', toNode: children[0].id }] : [],
      caseCount: children.length,
    };
  });
  const cases = MINDMAP_CATEGORIES.flatMap((category) => {
    const children = groups.get(category.id);
    return children.map((record, index) => ({
      ...record,
      connections: children[index + 1]
        ? [{ direction: '出线', toNode: children[index + 1].id }]
        : [],
    }));
  });
  return [
    {
      id: 'root',
      index: -5,
      isCategory: true,
      isRoot: true,
      connections: categories.map((category) => ({ direction: '出线', toNode: category.id })),
    },
    ...categories,
    ...cases,
  ];
}

export function buildMindmapGraph(records = []) {
  const ordered = [...records].sort((a, b) => a.index - b.index);
  return {
    ordered,
    byId: new Map(ordered.map((record) => [record.id, record])),
  };
}

export function getExpandableChildren(graph, id) {
  const record = graph.byId.get(id);
  if (!record) return [];
  const linked = (record.connections ?? [])
    .filter((connection) => connection.direction === '出线')
    .map((connection) => graph.byId.get(connection.toNode))
    .filter(Boolean);
  if (linked.length) return [...new Map(linked.map((item) => [item.id, item])).values()];
  const sequential = graph.ordered[record.index];
  return sequential ? [sequential] : [];
}
