export const MINDMAP_CATEGORIES = Object.freeze([]);

export function buildProcessGraph(records = []) {
  const ordered = [...records].sort((a, b) => a.index - b.index);
  const mainline = ordered.filter((record) => record.status !== 'error');
  const edges = [];
  let cursor = 0;
  let anchor = 'root';

  while (cursor < ordered.length) {
    const errors = [];
    while (ordered[cursor]?.status === 'error') errors.push(ordered[cursor++]);
    const next = ordered[cursor];

    if (next) edges.push({ from: anchor, to: next.id, kind: 'main' });
    if (errors.length) {
      edges.push({ from: anchor, to: errors[0].id, kind: 'error' });
      errors.slice(1).forEach((item, index) => {
        edges.push({ from: errors[index].id, to: item.id, kind: 'error' });
      });
      if (next) edges.push({ from: errors.at(-1).id, to: next.id, kind: 'return' });
    }

    if (!next) break;
    anchor = next.id;
    cursor += 1;
  }

  return { nodes: ordered, mainline, edges };
}

// Kept as the public adapter used by archive-mindmap.js. It now returns a
// process graph rather than invented category nodes.
export function buildCategorizedMindmapRecords(records = []) {
  const process = buildProcessGraph(records);
  const connections = new Map([['root', []]]);
  process.nodes.forEach((record) => connections.set(record.id, []));
  process.edges.forEach((edge) => {
    connections.get(edge.from)?.push({
      direction: '出线',
      toNode: edge.to,
      kind: edge.kind,
    });
  });
  return [
    {
      id: 'root',
      index: 0,
      isRoot: true,
      connections: connections.get('root'),
    },
    ...process.nodes.map((record) => ({
      ...record,
      connections: connections.get(record.id),
    })),
  ];
}

export function buildMindmapGraph(records = []) {
  const ordered = [...records];
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
  const index = graph.ordered.findIndex((item) => item.id === id);
  return index >= 0 && graph.ordered[index + 1] ? [graph.ordered[index + 1]] : [];
}

export function edgeKind(graph, fromId, toId) {
  return graph.byId.get(fromId)?.connections
    ?.find((connection) => connection.toNode === toId)?.kind ?? 'main';
}
