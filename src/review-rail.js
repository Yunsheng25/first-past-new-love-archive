function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasCase(blocks = []) {
  return blocks.some((block) => block?.type === 'callout'
    || (block?.type === 'image' && /示例|案例|例子/.test(block.section ?? '')));
}

export function buildReviewRail(data, target) {
  let order = 0;
  return (data?.chapters ?? []).flatMap((chapter) =>
    (chapter.pages ?? []).map((blocks, index) => {
      const sequence = order + 1;
      const kind = index === 0 ? 'chapter' : hasCase(blocks) ? 'case' : 'page';
      const title = index === 0
        ? chapter.title
        : blocks.find((block) => block?.section)?.section || `第 ${index + 1} 页`;
      order += 1;
      return {
        id: `${chapter.slug}-${index + 1}`,
        order: sequence - 1,
        sequence,
        kind,
        title,
        label: title,
        meta: `第 ${String(sequence).padStart(2, '0')} 项 · ${index === 0 ? '章节起点' : `第 ${index + 1} 页`}`,
        href: `#review/${encodeURIComponent(chapter.slug)}/${index + 1}`,
        current: chapter.slug === target?.chapter?.slug && index === target?.pageIndex,
      };
    }));
}

export function reviewRailMarkup(items = []) {
  return `<nav class="review-rail" data-review-rail aria-label="全文索引">${items.map((item) =>
    `<a class="review-rail-tick is-${item.kind}${item.current ? ' is-current' : ''}" href="${item.href}" data-review-rail-tick data-review-direction="jump"${item.current ? ' aria-current="page"' : ''}><span class="review-rail-tip"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.meta)}</small></span></a>`
  ).join('')}</nav>`;
}
