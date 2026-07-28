export function particleCountForViewport(width, height) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const area = safeWidth * safeHeight;
  return Math.min(320, Math.max(48, Math.floor(area / 3800)));
}

export function particleAttraction(particle, pointer, active, reach = 310) {
  const dx = pointer.x - particle.x;
  const dy = pointer.y - particle.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));

  if (!active || distance >= reach) {
    return {
      accelerationX: (particle.originX - particle.x) * 0.00045,
      accelerationY: (particle.originY - particle.y) * 0.00045,
      proximity: 0,
    };
  }

  const proximity = 1 - distance / reach;
  const pull = 0.13 * proximity ** 2;
  const orbit = distance < 125 ? 0.085 * (1 - distance / 125) : 0;

  return {
    accelerationX: (dx / distance) * pull - (dy / distance) * orbit,
    accelerationY: (dy / distance) * pull + (dx / distance) * orbit,
    proximity,
  };
}

function particleSeed(width, height, random) {
  const x = random() * width;
  const y = random() * height;

  return {
    x,
    y,
    originX: x,
    originY: y,
    vx: (random() - 0.5) * 0.14,
    vy: (random() - 0.5) * 0.14,
    size: 0.55 + random() * 1.35,
  };
}

export function mountGlobalParticles(
  root,
  {
    windowRef: view = globalThis.window,
    documentRef: doc = globalThis.document,
    matchMedia = globalThis.matchMedia?.bind(globalThis),
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    createObserver = globalThis.MutationObserver
      ? (callback) => new globalThis.MutationObserver(callback)
      : null,
    now = () => globalThis.performance?.now?.() || Date.now(),
    random = Math.random,
  } = {},
) {
  const noop = () => {};

  try {
    if (!root || !doc?.createElement || !requestFrame) return noop;
    if (matchMedia && !matchMedia("(pointer: fine)")?.matches) return noop;
    if (matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return noop;

    const canvas = doc.createElement("canvas");
    canvas.className = "global-particle-field";
    canvas.setAttribute("aria-hidden", "true");

    const context = canvas.getContext?.("2d");
    if (!context) return noop;

    let destroyed = false;
    let pointerActive = false;
    let lastMove = 0;
    let frameId = null;
    let host = null;
    let width = 0;
    let height = 0;
    let particles = [];
    const pointer = { x: 0, y: 0 };

    function resize() {
      if (!host) return;

      const rect = host.getBoundingClientRect?.() || {};
      width = Math.max(1, rect.width || view?.innerWidth || 1);
      height = Math.max(1, rect.height || view?.innerHeight || 1);
      const pixelRatio = Math.min(2, Math.max(1, view?.devicePixelRatio || 1));

      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform?.(pixelRatio, 0, 0, pixelRatio, 0, 0);

      particles = Array.from(
        { length: particleCountForViewport(width, height) },
        () => particleSeed(width, height, random),
      );
      pointer.x = width / 2;
      pointer.y = height / 2;
    }

    function attach() {
      if (destroyed) return;

      const nextHost = root.matches?.(".app-view")
        ? root
        : root.querySelector?.(".app-view");
      if (!nextHost) return;

      if (host !== nextHost || canvas.parentNode !== nextHost) {
        host = nextHost;
        host.prepend(canvas);
        resize();
      }
    }

    function drawDot(particle, proximity, intensity) {
      const alpha = (0.17 + proximity * 0.55) * intensity;
      const radius = particle.size * (1 + proximity * 1.75);

      context.beginPath();
      context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(220, 184, 148, ${alpha})`;
      context.fill();

      if (proximity > 0.34) {
        context.beginPath();
        context.moveTo(particle.x, particle.y);
        context.lineTo(
          particle.x - particle.vx * 18,
          particle.y - particle.vy * 18,
        );
        context.strokeStyle = `rgba(195, 121, 103, ${
          proximity * 0.26 * intensity
        })`;
        context.lineWidth = 0.55 + proximity * 0.65;
        context.stroke();
      }
    }

    function draw(timestamp = now()) {
      frameId = null;
      if (destroyed || doc.hidden) return;

      if (pointerActive && timestamp - lastMove > 1500) {
        pointerActive = false;
      }

      attach();
      if (!host) {
        frameId = requestFrame(draw);
        return;
      }

      context.clearRect(0, 0, width, height);
      const intensity = host.classList?.contains("review-reader-view") ? 0.75 : 1;

      particles.forEach((particle) => {
        const response = particleAttraction(
          particle,
          pointer,
          pointerActive,
        );
        particle.vx += response.accelerationX;
        particle.vy += response.accelerationY;
        particle.vx *= 0.976;
        particle.vy *= 0.976;
        particle.x += particle.vx;
        particle.y += particle.vy;
        drawDot(particle, response.proximity, intensity);
      });

      frameId = requestFrame(draw);
    }

    function onPointerMove(event) {
      attach();
      if (!host) return;

      const rect = host.getBoundingClientRect?.() || { left: 0, top: 0 };
      pointer.x = event.clientX - (rect.left || 0);
      pointer.y = event.clientY - (rect.top || 0);
      pointerActive = true;
      lastMove = now();
    }

    function onPointerLeave() {
      pointerActive = false;
    }

    function onVisibilityChange() {
      if (doc.hidden) {
        if (frameId !== null) cancelFrame?.(frameId);
        frameId = null;
        return;
      }
      if (frameId === null && !destroyed) {
        frameId = requestFrame(draw);
      }
    }

    const observer = createObserver
      ? createObserver(attach)
      : { observe: noop, disconnect: noop };
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", onPointerLeave);
    view?.addEventListener?.("resize", resize);
    doc.addEventListener?.("visibilitychange", onVisibilityChange);

    attach();
    frameId = requestFrame(draw);

    return () => {
      destroyed = true;
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      view?.removeEventListener?.("resize", resize);
      doc.removeEventListener?.("visibilitychange", onVisibilityChange);
      observer.disconnect();
      if (frameId !== null) cancelFrame?.(frameId);
      canvas.remove?.();
    };
  } catch {
    return noop;
  }
}
