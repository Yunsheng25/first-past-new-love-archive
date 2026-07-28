import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterMagnetism,
  mountCharacterMotion,
  splitTextCharacters,
} from '../src/text-motion.js';

test('splitTextCharacters preserves spaces and punctuation', () => {
  assert.deepEqual(splitTextCharacters('初恋 · 旧爱'), ['初', '恋', ' ', '·', ' ', '旧', '爱']);
});

test('character magnetism responds before the pointer touches the glyph', () => {
  const response = characterMagnetism({ x: 100, y: 100 }, { x: 220, y: 100 }, 180);
  assert.ok(response.power > 0);
  assert.ok(response.lift < 0);
  assert.ok(response.scale > 1);
  assert.equal(characterMagnetism({ x: 100, y: 100 }, { x: 281, y: 100 }, 180).power, 0);
});

test('mounted character motion listens on the whole root and cleanup restores characters', () => {
  const properties = new Map();
  const style = {
    setProperty(name, value) { properties.set(name, String(value)); },
    removeProperty(name) { properties.delete(name); },
    getPropertyValue(name) { return properties.get(name) ?? ''; },
  };
  const character = {
    style,
    getBoundingClientRect: () => ({ left: 80, top: 80, width: 20, height: 40 }),
  };
  const listeners = new Map();
  const root = {
    querySelectorAll(selector) {
      return selector === '.motion-character' ? [character] : [];
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };

  const cleanup = mountCharacterMotion(root, '[data-character-motion]', {
    matchMedia: (query) => ({ matches: query.includes('pointer: fine') }),
  });
  assert.equal(listeners.has('pointermove'), true);
  listeners.get('pointermove')({ clientX: 180, clientY: 100 });
  assert.notEqual(style.getPropertyValue('--motion-lift'), '');
  cleanup();
  assert.equal(listeners.has('pointermove'), false);
  assert.equal(style.getPropertyValue('--motion-lift'), '');
});
