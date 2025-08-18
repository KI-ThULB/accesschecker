import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWcagTags, deriveBitv, deriveEn } from '../scripts/lib/norms.js';

test('normalizeWcagTags parses axe tags', () => {
  const tags = ['wcag111', 'wcag131b', 'WCAG242', 'random', 'wcag2a'];
  assert.deepStrictEqual(normalizeWcagTags(tags), ['1.1.1', '1.3.1b', '2.4.2']);
});

test('deriveBitv/en derive from wcag ids', () => {
  const ids = ['1.1.1', '2.4.2', '3.1.1b'];
  assert.deepStrictEqual(deriveBitv(ids), ['9.1.1.1', '9.2.4.2', '9.3.1.1b']);
  assert.deepStrictEqual(deriveEn(ids), ['9.1.1.1', '9.2.4.2', '9.3.1.1b']);
});
