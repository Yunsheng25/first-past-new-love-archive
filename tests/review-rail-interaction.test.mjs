import test from 'node:test';
import assert from 'node:assert/strict';
import { mountReviewRail, nearestTickIndex } from '../src/review-rail-interaction.js';

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
    contains: (name) => values.has(name),
  };
}

function fixture() {
  const listeners = new Map();
  const styleValues = new Map();
  const ticks = [10, 40, 80].map((top) => ({
    classList: classList(),
    getBoundingClientRect: () => ({ top, height: 2 }),
  }));
  const rail = {
    classList: classList(),
    style: {
      setProperty: (name, value) => styleValues.set(name, value),
      removeProperty: (name) => styleValues.delete(name),
    },
    querySelectorAll: () => ticks,
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
  };
  return {
    root: { querySelector: () => rail },
    rail,
    ticks,
    listeners,
    styleValues,
  };
}

test('nearest tick uses vertical distance and handles an empty rail', () => {
  assert.equal(nearestTickIndex([10, 40, 80], 56), 1);
  assert.equal(nearestTickIndex([10, 40, 80], 72), 2);
  assert.equal(nearestTickIndex([], 20), -1);
});

test('wide rail interaction activates the nearest tick and its neighbors', () => {
  const view = fixture();
  const cleanup = mountReviewRail(view.root);
  view.listeners.get('pointermove')({ clientY: 56 });

  assert.equal(view.rail.classList.contains('is-interacting'), true);
  assert.equal(view.ticks[1].classList.contains('is-active'), true);
  assert.equal(view.ticks[0].classList.contains('is-near'), true);
  assert.equal(view.ticks[2].classList.contains('is-near'), true);
  assert.equal(view.styleValues.get('--review-rail-y'), '56px');

  view.listeners.get('pointerleave')();
  assert.equal(view.rail.classList.contains('is-interacting'), false);
  assert.equal(view.ticks.some((tick) => tick.classList.contains('is-active')), false);

  cleanup();
  assert.equal(view.listeners.size, 0);
});
