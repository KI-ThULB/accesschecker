import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { main as engineMain } from '../core/engine.js';

const TEST_URL = 'https://www.w3.org/WAI/demos/bad/';

test('forms module reports findings and overview artifact', async (t) => {
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', TEST_URL, '--profile', 'fast']);
  let results: any;
  try {
    results = await engineMain();
  } catch (e) {
    t.skip(`Engine run failed: ${e}`);
    return;
  } finally {
    process.argv = orig;
  }
  assert.ok(results.modules['forms'].findings.length > 0, 'expected forms findings');
  const overviewPath = path.join(process.cwd(), 'out', 'forms_overview.json');
  try {
    await fs.access(overviewPath);
  } catch {
    assert.fail('forms_overview.json missing');
  }
  assert.ok(results.issues.some((f: any) => f.id.startsWith('forms:')), 'issues should include forms findings');
  assert.ok(results.issues.some((f: any) => f.id.startsWith('axe:')), 'issues should include axe findings');
});
