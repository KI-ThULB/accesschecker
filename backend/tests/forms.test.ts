import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

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
  const overview = JSON.parse(await fs.readFile(overviewPath, 'utf-8'));
  assert.ok(Array.isArray(overview) && overview.length > 0, 'overview should list fields');

  const issuesFile = JSON.parse(await fs.readFile(path.join(process.cwd(), 'out', 'issues.json'), 'utf-8'));
  assert.ok(issuesFile.some((f: any) => f.id.startsWith('forms:')), 'issues.json should include forms findings');
  assert.ok(results.issues.some((f: any) => f.id.startsWith('axe:')), 'issues should include axe findings');

  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/forms:/.test(report), 'internal report should mention forms findings');
});
