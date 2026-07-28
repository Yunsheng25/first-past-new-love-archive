export function splitTextCharacters(text) {
  return [...text];
}

export function characterMagnetism(character, pointer, reach = 180) {
  const distance = Math.hypot(character.x - pointer.x, character.y - pointer.y);
  if (distance >= reach) return { power: 0, lift: 0, scale: 1, glow: 0 };
  const power = 1 - distance / reach;
  return {
    power,
    lift: -13 * power,
    scale: 1 + 0.08 * power,
    glow: 0.55 * power,
  };
}

export function mountCharacterMotion(
  root,
  selector = '[data-character-motion]',
  { matchMedia = (query) => globalThis.matchMedia?.(query) } = {},
) {
  if (!root?.querySelectorAll) return () => {};
  let finePointer = false;
  let reducedMotion = false;
  try {
    finePointer = Boolean(matchMedia?.('(hover: hover) and (pointer: fine)')?.matches);
    reducedMotion = Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return () => {};
  }
  if (!finePointer || reducedMotion) return () => {};

  for (const element of root.querySelectorAll(selector)) {
    if (element.dataset.characterMotionMounted === 'true') continue;
    const documentRef = element.ownerDocument;
    const textNodes = [...element.childNodes].filter((node) => node.nodeType === 3);
    for (const textNode of textNodes) {
      const fragment = documentRef.createDocumentFragment();
      for (const character of splitTextCharacters(textNode.textContent ?? '')) {
        const span = documentRef.createElement('span');
        span.className = 'motion-character';
        span.textContent = character;
        fragment.append(span);
      }
      textNode.replaceWith(fragment);
    }
    element.dataset.characterMotionMounted = 'true';
  }
  const characters = [...root.querySelectorAll('.motion-character')];
  const reset = () => characters.forEach((character) => {
    character.style.removeProperty('--motion-lift');
    character.style.removeProperty('--motion-scale');
    character.style.removeProperty('--motion-glow');
  });
  const move = (event) => characters.forEach((character) => {
    const bounds = character.getBoundingClientRect();
    const response = characterMagnetism(
      { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
      { x: event.clientX, y: event.clientY },
    );
    character.style.setProperty('--motion-lift', `${response.lift}px`);
    character.style.setProperty('--motion-scale', response.scale);
    character.style.setProperty('--motion-glow', response.glow);
  });
  root.addEventListener('pointermove', move, { passive: true });
  root.addEventListener('pointerleave', reset, { passive: true });

  return () => {
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerleave', reset);
    reset();
  };
}
