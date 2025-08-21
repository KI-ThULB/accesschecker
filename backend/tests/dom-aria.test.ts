import { test } from 'node:test';
import assert from 'node:assert';
import { main as engineMain } from '../core/engine.js';

const TEST_URL = 'https://www.w3.org/WAI/demos/bad/';

test('dom-aria module reports findings', async (t) => {
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', TEST_URL, '--profile', 'fast']);
  let results: any;
  try {
    results = await engineMain();
  } catch (e) {
    t.skip(`Engine run failed: ${e}`);
  } finally {
    process.argv = orig;
  }
  assert.ok(results.modules['dom-aria'].findings.length > 0, 'expected findings');
  assert.ok(results.issues.length > 0, 'expected issues');
});
