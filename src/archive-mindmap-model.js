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
