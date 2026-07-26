import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticleSeeds, getParticleResponse } from '../src/mindmap-ambient.js';

test('creates the approved particle density deterministically', () => {
  assert.equal(createParticleSeeds(72).length, 72);
  assert.deepEqual(createParticleSeeds(2), createParticleSeeds(2));
});

test('nearby particles are pushed and brightened', () => {
  const response = getParticleResponse({ x: 100, y: 100 }, { x: 110, y: 100 }, 190);
  assert.ok(Math.abs(response.pushX) > 0);
  assert.ok(response.scale > 1);
  assert.ok(response.opacity > 0.28);
});
