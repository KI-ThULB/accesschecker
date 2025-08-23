import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig } from '../core/config.js';
import { getModules } from '../core/registry.js';

test('getModules loads modules from profile', async () => {
  const cfg = await loadConfig(['--profile', 'fast']);
  const mods = await getModules([], cfg.profile, cfg);
  const slugs = mods.map(m => m.slug);
  assert.ok(slugs.includes('dom-aria'));
  assert.ok(slugs.includes('forms'));
  assert.ok(slugs.includes('headings-outline'));
});

test('getModules wildcard', async () => {
  const cfg = await loadConfig();
  const mods = await getModules(['*'], cfg.profile, cfg);
  assert.ok(mods.length >= 6);
});
