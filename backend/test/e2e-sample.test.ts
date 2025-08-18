import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { enrichWithFallback } from '../scripts/lib/norms.js';

test('WAI BAD sample rules carry norms', async () => {
  const mapArr = JSON.parse(await fs.readFile(path.resolve('config/rules_mapping.json'), 'utf-8'));
  const byId: Record<string, any> = {};
  for (const m of mapArr) {
    byId[m.axeRuleId] = {
      wcagRefs: m.wcagRefs || m.wcag || [],
      bitvRefs: m.bitvRefs || m.bitv || [],
      en301549Refs: m.en301549Refs || m.en301549 || []
    };
  }
  const ids = ['select-name','label','empty-table-header','label-title-only'];
  for (const id of ids) {
    const v: any = { id, tags: [] };
    const entry = byId[id];
    if (entry) {
      v.wcagRefs = entry.wcagRefs;
      v.bitvRefs = entry.bitvRefs;
      v.en301549Refs = entry.en301549Refs;
    }
    enrichWithFallback(v);
    assert.ok(v.wcagRefs.length && v.bitvRefs.length && v.en301549Refs.length, `${id} should have norms`);
  }
});
