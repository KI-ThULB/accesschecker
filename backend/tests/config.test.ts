import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig } from '../core/config.js';

test('loadConfig merges profile modules', async () => {
  const cfg = await loadConfig(['--profile', 'fast']);
  assert.equal(cfg.profile, 'fast');
  assert.equal(cfg.modules['dom-aria'], true);
});

test('modules override via cli', async () => {
  const cfg = await loadConfig(['--modules', 'forms']);
  assert.equal(Object.keys(cfg.modules).length, 1);
  assert.ok(cfg.modules['forms']);
});
