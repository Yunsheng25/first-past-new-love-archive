export function createParticleSeeds(count = 72) {
  return Array.from({ length: count }, (_, index) => ({
    left: (index * 37 + index * index * 3) % 97 + 1,
    top: (index * 61 + index * index * 5) % 91 + 4,
    duration: 3.6 + (index % 9) * 0.48,
  }));
}

export function getParticleResponse(particle, pointer, reach = 190) {
  const vx = particle.x - pointer.x;
  const vy = particle.y - pointer.y;
  const distance = Math.hypot(vx, vy);
  if (distance >= reach) return { pushX: 0, pushY: 0, scale: 1, opacity: 0.25 };
  const power = 1 - distance / reach;
  const length = distance || 1;
  return {
    pushX: (vx / length) * power * 34,
    pushY: (vy / length) * power * 34,
    scale: 1 + power * 1.15,
    opacity: 0.28 + power * 0.62,
  };
}

export function mountMindmapAmbient(viewport, {
  count = 72,
  reducedMotion = false,
} = {}) {
  const host = viewport?.querySelector?.('[data-mindmap-ambient]');
  if (!host) return () => {};
  const seeds = createParticleSeeds(count);
  const particles = seeds.map((seed) => {
    const particle = host.ownerDocument.createElement('i');
    particle.className = 'mindmap-particle';
    particle.style.left = `${seed.left}%`;
    particle.style.top = `${seed.top}%`;
    particle.style.setProperty('--particle-duration', `${seed.duration}s`);
    host.append(particle);
    return particle;
  });

  const onMove = (event) => {
    const box = viewport.getBoundingClientRect();
    const pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    viewport.style.setProperty('--mindmap-mouse-x', `${pointer.x}px`);
    viewport.style.setProperty('--mindmap-mouse-y', `${pointer.y}px`);
    const dx = pointer.x / box.width - 0.5;
    const dy = pointer.y / box.height - 0.5;
    viewport.style.setProperty('--mindmap-grid-x', `${-dx * 13}px`);
    viewport.style.setProperty('--mindmap-grid-y', `${-dy * 13}px`);
    host.style.transform = `translate(${dx * 16}px, ${dy * 16}px)`;
    if (reducedMotion) return;
    particles.forEach((particle, index) => {
      const seed = seeds[index];
      const response = getParticleResponse(
        { x: seed.left / 100 * box.width, y: seed.top / 100 * box.height },
        pointer,
      );
      particle.style.setProperty('--particle-push-x', `${response.pushX}px`);
      particle.style.setProperty('--particle-push-y', `${response.pushY}px`);
      particle.style.setProperty('--particle-scale', response.scale);
      particle.style.opacity = response.opacity;
    });
  };
  viewport.addEventListener('pointermove', onMove);
  return () => {
    viewport.removeEventListener('pointermove', onMove);
    particles.forEach((particle) => particle.remove());
  };
}
