function isReviewPage(route) {
  return route?.name === 'review-page';
}

function eligibleActivation(event) {
  return (event.button === undefined || event.button === 0)
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function createReviewTurnController({
  documentRef = document,
  windowRef = window,
  parseRoute,
  renderRoute,
  peekReviewData,
  reducedMotion = () => false,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  timeoutMs = 850,
} = {}) {
  let currentRenderedRoute = null;
  let intent = null;
  let active = null;
  let pending = null;
  let destroyed = false;

  const render = (route) => {
    renderRoute(route);
    currentRenderedRoute = route;
  };

  const finish = (token) => {
    if (active?.token !== token) return;
    clearTimeoutFn(active.timeout);
    documentRef.documentElement.classList.remove(active.className);
    active = null;
    if (pending) {
      const next = pending;
      pending = null;
      run(next.route, next.direction);
    }
  };

  const run = (route, direction) => {
    const canTurn = !destroyed
      && direction
      && isReviewPage(currentRenderedRoute)
      && isReviewPage(route)
      && Boolean(peekReviewData())
      && typeof documentRef.startViewTransition === 'function'
      && !reducedMotion();
    if (!canTurn) {
      render(route);
      return;
    }

    const token = Symbol('review-turn');
    const className = `review-turn-${direction}`;
    documentRef.documentElement.classList.add(className);
    active = { token, className, timeout: null };
    try {
      const transition = documentRef.startViewTransition(() => {
        if (!destroyed && active?.token === token) render(route);
      });
      active.timeout = setTimeoutFn(() => finish(token), timeoutMs);
      Promise.resolve(transition?.finished).then(() => finish(token), () => finish(token));
    } catch {
      finish(token);
      render(route);
    }
  };

  const handleHashChange = () => {
    if (destroyed) return;
    const route = parseRoute(windowRef.location.hash);
    const direction = intent;
    intent = null;
    if (active) {
      pending = { route, direction };
      return;
    }
    run(route, direction);
  };

  return {
    renderInitial(route) { if (!destroyed) render(route); },
    recordIntent(event) {
      const link = event.target?.closest?.('[data-review-direction]');
      if (!link || !eligibleActivation(event)) return;
      const direction = link.dataset?.reviewDirection;
      if (direction === 'next' || direction === 'previous') intent = direction;
    },
    handleHashChange,
    destroy() {
      destroyed = true;
      pending = null;
      if (active) finish(active.token);
    },
    get currentRenderedRoute() { return currentRenderedRoute; },
  };
}
