export function flattenReviewPages(data) {
  return (data?.chapters ?? []).flatMap((chapter) =>
    (chapter.pages ?? []).map((blocks, pageIndex) => ({
      chapter,
      blocks,
      pageIndex,
      pageNumber: pageIndex + 1,
      href: `#review/${chapter.slug}/${pageIndex + 1}`,
    })));
}

export function resolveReviewSpread(data, chapterSlug, pageNumber) {
  const requestedPage = Number(pageNumber);
  if (!Number.isInteger(requestedPage) || requestedPage < 1) return null;

  const pages = flattenReviewPages(data);
  const requestedIndex = pages.findIndex((page) =>
    page.chapter.slug === chapterSlug && page.pageNumber === requestedPage);
  if (requestedIndex < 0) return null;

  const leftIndex = requestedIndex - (requestedIndex % 2);
  return {
    index: leftIndex / 2,
    overallStart: leftIndex + 1,
    left: pages[leftIndex],
    right: pages[leftIndex + 1] ?? null,
    previousHref: pages[leftIndex - 2]?.href ?? null,
    nextHref: pages[leftIndex + 2]?.href ?? null,
  };
}
