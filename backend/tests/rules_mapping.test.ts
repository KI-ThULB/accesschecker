import { test } from 'node:test';
import assert from 'node:assert';
import mapping from '../config/rules_mapping.json' assert { type: 'json' };

const map: Record<string, any> = mapping as any;

test('rules mapping has at least 5 entries', () => {
  assert.ok(Object.keys(map).length >= 5);
});

test('common rules have mappings', () => {
  const sample = ['link-name', 'image-alt', 'color-contrast'];
  for (const id of sample) {
    const entry = map[id];
    assert.ok(entry, `missing mapping for ${id}`);
    assert.ok(Array.isArray(entry.wcag) && entry.wcag.length > 0, `missing wcag for ${id}`);
  }
});
