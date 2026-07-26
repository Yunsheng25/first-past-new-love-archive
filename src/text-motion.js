export function splitTextCharacters(text) {
  return [...text];
}

export function mountCharacterMotion(root, selector = '[data-character-motion]') {
  if (!root?.querySelectorAll) return;
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
}
