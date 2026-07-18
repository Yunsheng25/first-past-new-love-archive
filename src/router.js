const introRoute = () => ({ name: 'intro' });

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function pageNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

export function parseRoute(hash = window.location.hash) {
  const path = hash.replace(/^#/, '');
  const segments = path.split('/');

  if (!path) return introRoute();
  if (path === 'film') return { name: 'film' };
  if (path === 'after') return { name: 'after' };
  if (path === 'review') return { name: 'review-index' };
  if (path === 'archive') return { name: 'archive-index' };

  if (segments.length === 3 && segments[0] === 'review') {
    const category = decodeSegment(segments[1]);
    if (category === null) return introRoute();
    return { name: 'review-page', chapter: category, page: pageNumber(segments[2]) };
  }

  if (segments.length === 2 && segments[0] === 'archive') {
    const id = decodeSegment(segments[1]);
    if (id === null) return introRoute();
    return { name: 'archive-detail', id };
  }

  return introRoute();
}

export function routeHref(name, params = {}) {
  switch (name) {
    case 'film':
      return '#film';
    case 'after':
      return '#after';
    case 'review-index':
      return '#review';
    case 'review-page':
      return `#review/${encodeURIComponent(params.chapter ?? '')}/${pageNumber(params.page)}`;
    case 'archive-index':
      return '#archive';
    case 'archive-detail':
      return `#archive/${encodeURIComponent(params.id ?? '')}`;
    case 'intro':
    default:
      return '';
  }
}
