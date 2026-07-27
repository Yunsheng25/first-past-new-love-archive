export function nearestTickIndex(centers = [], pointerY = 0) {
  let best = -1;
  let distance = Infinity;
  centers.forEach((center, index) => {
    const next = Math.abs(pointerY - center);
    if (next < distance) {
      best = index;
      distance = next;
    }
  });
  return best;
}

export function mountReviewRail(root) {
  const rail = root?.querySelector?.('[data-review-rail]');
  if (!rail) return () => {};
  const ticks = [...(rail.querySelectorAll?.('[data-review-rail-tick]') ?? [])];
  if (!ticks.length) return () => {};

  const clear = () => {
    rail.classList.remove('is-interacting');
    rail.style.removeProperty('--review-rail-y');
    ticks.forEach((tick) => tick.classList.remove('is-active', 'is-near'));
  };

  const activate = (index) => {
    ticks.forEach((tick, tickIndex) => {
      tick.classList.toggle('is-active', tickIndex === index);
      tick.classList.toggle('is-near', Math.abs(tickIndex - index) === 1);
    });
  };

  const onPointerMove = (event) => {
    const railBox = rail.getBoundingClientRect();
    const centers = ticks.map((tick) => {
      const box = tick.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    const index = nearestTickIndex(centers, event.clientY);
    if (index < 0) return;
    rail.classList.add('is-interacting');
    rail.style.setProperty('--review-rail-y', `${event.clientY - railBox.top}px`);
    activate(index);
  };

  const onFocusIn = (event) => {
    const index = ticks.indexOf(event.target?.closest?.('[data-review-rail-tick]'));
    if (index < 0) return;
    rail.classList.add('is-interacting');
    activate(index);
  };

  const onFocusOut = (event) => {
    if (!rail.contains?.(event.relatedTarget)) clear();
  };

  rail.addEventListener('pointermove', onPointerMove);
  rail.addEventListener('pointerleave', clear);
  rail.addEventListener('focusin', onFocusIn);
  rail.addEventListener('focusout', onFocusOut);
  return () => {
    clear();
    rail.removeEventListener('pointermove', onPointerMove);
    rail.removeEventListener('pointerleave', clear);
    rail.removeEventListener('focusin', onFocusIn);
    rail.removeEventListener('focusout', onFocusOut);
  };
}
