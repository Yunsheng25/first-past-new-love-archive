export function fitBounds(boxes, viewport, padding = 80) {
  if (!boxes.length) return { scale: 0.72, x: 0, y: 0 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const scale = Math.min(
    0.9,
    (viewport.width - padding) / Math.max(1, maxX - minX),
    (viewport.height - padding) / Math.max(1, maxY - minY),
  );
  return {
    scale,
    x: viewport.width / 2 - ((minX + maxX) / 2) * scale,
    y: viewport.height / 2 - ((minY + maxY) / 2) * scale,
  };
}

export function restoreReadingView(box, viewport) {
  const scale = 0.72;
  return {
    scale,
    x: viewport.width * 0.6 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
  };
}
