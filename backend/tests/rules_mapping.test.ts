import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';

const mapping = JSON.parse(await fs.readFile(new URL('../config/rules_mapping.json', import.meta.url), 'utf-8'));

test('rules mapping has at least 40 entries', () => {
  assert.ok(mapping.length >= 40);
});

test('common rules have mappings', () => {
  const byId: Record<string, any> = {};
  for (const m of mapping) byId[m.axeRuleId] = m;
  const sample = ['link-name', 'image-alt', 'color-contrast'];
  for (const id of sample) {
    const entry = byId[id];
    assert.ok(entry, `missing mapping for ${id}`);
    assert.ok(Array.isArray(entry.wcag) && entry.wcag.length > 0, `missing wcag for ${id}`);
  }
});
