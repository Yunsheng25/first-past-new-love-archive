export function mountAfterCursor(
  root,
  {
    matchMedia = (query) => globalThis.matchMedia?.(query),
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  } = {},
) {
  let finePointer = false;
  let reduceMotion = false;
  try {
    finePointer = Boolean(matchMedia?.('(hover: hover) and (pointer: fine)')?.matches);
    reduceMotion = Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return () => {};
  }
  if (!finePointer) return () => {};

  const view = root?.querySelector?.('.after-view');
  const cursor = root?.querySelector?.('[data-after-cursor]');
  if (!view || !cursor) return () => {};

  let active = true;
  let frameId;
  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;
  let hoveredChoice = null;

  const paint = () => {
    if (!active) return;
    currentX += (targetX - currentX) * 0.22;
    currentY += (targetY - currentY) * 0.22;
    cursor.style.setProperty('--cursor-x', `${currentX}px`);
    cursor.style.setProperty('--cursor-y', `${currentY}px`);
    frameId = requestFrame(paint);
  };

  const setChoice = (choice) => {
    if (hoveredChoice === choice) return;
    hoveredChoice?.classList?.remove('is-cursor-over');
    hoveredChoice = choice;
    hoveredChoice?.classList?.add('is-cursor-over');
    cursor.classList?.toggle('is-over-choice', Boolean(choice));
  };

  const move = (event) => {
    targetX = Number(event?.clientX) || 0;
    targetY = Number(event?.clientY) || 0;
    if (reduceMotion) {
      currentX = targetX;
      currentY = targetY;
      cursor.style.setProperty('--cursor-x', `${currentX}px`);
      cursor.style.setProperty('--cursor-y', `${currentY}px`);
    }
    cursor.classList?.add('is-visible');
    setChoice(event?.target?.closest?.('.after-choice') ?? null);
  };
  const leave = () => {
    cursor.classList?.remove('is-visible');
    setChoice(null);
  };
  const enter = () => cursor.classList?.add('is-visible');

  view.classList?.add('cursor-ready');
  view.addEventListener?.('pointermove', move, { passive: true });
  view.addEventListener?.('pointerleave', leave, { passive: true });
  view.addEventListener?.('pointerenter', enter, { passive: true });
  if (!reduceMotion) frameId = requestFrame(paint);

  return () => {
    if (!active) return;
    active = false;
    view.removeEventListener?.('pointermove', move);
    view.removeEventListener?.('pointerleave', leave);
    view.removeEventListener?.('pointerenter', enter);
    view.classList?.remove('cursor-ready');
    cursor.classList?.remove('is-visible');
    setChoice(null);
    if (frameId !== undefined) cancelFrame(frameId);
  };
}
