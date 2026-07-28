import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mountGlobalParticles,
  particleAttraction,
  particleCountForViewport,
} from '../src/global-particles.js';

test('particle density scales with area and stays capped', () => {
  assert.equal(particleCountForViewport(1440, 900), 320);
  assert.ok(particleCountForViewport(800, 600) < 320);
  assert.equal(particleCountForViewport(8000, 4000), 320);
});

test('particles inside 310px attract and orbit while inactive particles return home', () => {
  const near = particleAttraction(
    { x: 100, y: 100, originX: 20, originY: 20 },
    { x: 220, y: 100 },
    true,
  );
  assert.ok(near.accelerationX > 0);
  assert.notEqual(near.accelerationY, 0);
  assert.ok(near.proximity > 0);

  const inactive = particleAttraction(
    { x: 100, y: 100, originX: 20, originY: 20 },
    { x: 220, y: 100 },
    false,
  );
  assert.ok(inactive.accelerationX < 0);
  assert.ok(inactive.accelerationY < 0);
  assert.equal(inactive.proximity, 0);
});

function lifecycleFixture({ finePointer = true, reducedMotion = false } = {}) {
  const rootListeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const cancelledFrames = [];
  let createdCanvas = null;
  let observerDisconnected = false;
  const context = new Proxy({}, {
    get(target, property) {
      if (property === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      if (!(property in target)) target[property] = () => {};
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  const host = {
    firstChild: null,
    getBoundingClientRect: () => ({ width: 900, height: 600 }),
    prepend(node) {
      this.firstChild = node;
      node.parentNode = this;
    },
  };
  const root = {
    listeners: rootListeners,
    querySelector: (selector) => selector === '.app-view' ? host : null,
    addEventListener: (type, listener) => rootListeners.set(type, listener),
    removeEventListener(type, listener) {
      if (rootListeners.get(type) === listener) rootListeners.delete(type);
    },
  };
  const documentRef = {
    visibilityState: 'visible',
    listeners: documentListeners,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      createdCanvas = {
        className: '',
        style: {},
        removed: false,
        setAttribute() {},
        getContext: () => context,
        remove() {
          this.removed = true;
          if (host.firstChild === this) host.firstChild = null;
        },
      };
      return createdCanvas;
    },
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
  };
  const windowRef = {
    devicePixelRatio: 1,
    innerWidth: 900,
    innerHeight: 600,
    listeners: windowListeners,
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
  };
  return {
    root,
    host,
    documentRef,
    windowRef,
    cancelledFrames,
    get canvas() { return createdCanvas; },
    get observerDisconnected() { return observerDisconnected; },
    options: {
      documentRef,
      windowRef,
      matchMedia(query) {
        return {
          matches: query.includes('pointer: fine') ? finePointer : reducedMotion,
        };
      },
      requestFrame: () => 91,
      cancelFrame: (id) => cancelledFrames.push(id),
      createObserver: () => ({
        observe() {},
        disconnect() { observerDisconnected = true; },
      }),
      now: () => 0,
      random: () => 0.5,
    },
  };
}

test('mounted particles attach once and cleanup removes listeners, frame, observer and canvas', () => {
  const fixture = lifecycleFixture();
  const cleanup = mountGlobalParticles(fixture.root, fixture.options);
  assert.equal(fixture.host.firstChild.className, 'global-particle-field');
  assert.equal(fixture.root.listeners.has('pointermove'), true);
  assert.equal(fixture.documentRef.listeners.has('visibilitychange'), true);
  cleanup();
  assert.equal(fixture.canvas.removed, true);
  assert.equal(fixture.root.listeners.has('pointermove'), false);
  assert.equal(fixture.documentRef.listeners.has('visibilitychange'), false);
  assert.deepEqual(fixture.cancelledFrames, [91]);
  assert.equal(fixture.observerDisconnected, true);
});

test('coarse pointers and reduced motion use a no-canvas fallback', () => {
  for (const options of [
    { finePointer: false, reducedMotion: false },
    { finePointer: true, reducedMotion: true },
  ]) {
    const fixture = lifecycleFixture(options);
    const cleanup = mountGlobalParticles(fixture.root, fixture.options);
    assert.equal(fixture.canvas, null);
    assert.equal(fixture.root.listeners.size, 0);
    cleanup();
  }
});
