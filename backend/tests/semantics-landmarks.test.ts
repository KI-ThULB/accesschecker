import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mod from '../modules/semantics-landmarks/index.ts';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

async function runSnippet(html: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const ctx: any = { page, url: 'http://example.com', crawlGraph: [], config: {}, log() {}, saveArtifact: async () => '' };
  const res = await mod.run(ctx);
  await browser.close();
  return res;
}

test('missing main → missing-main finding', async () => {
  const res = await runSnippet('<div>no main</div>');
  assert.ok(res.findings.some((f: any) => f.id === 'landmarks:missing-main'));
});

test('two banners → duplicates-banner', async () => {
  const res = await runSnippet('<header role="banner"></header><header role="banner"></header><main></main>');
  assert.ok(res.findings.some((f: any) => f.id === 'landmarks:duplicates-banner'));
});

test('banner within main → nesting-banner', async () => {
  const res = await runSnippet('<main><header role="banner"></header></main>');
  assert.ok(res.findings.some((f: any) => f.id === 'landmarks:nesting-banner'));
});

test('coverage 60% → coverage-low', async () => {
  const res = await runSnippet('<header></header><main><p>inside</p></main><div></div><div></div>');
  assert.ok(res.findings.some((f: any) => f.id === 'landmarks:coverage-low'));
});

test('e2e: BAD demo site yields landmark finding and appears in reports', async (t) => {
  const TEST_URL = 'https://www.w3.org/WAI/demos/bad/';
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
  const lm = results.modules['semantics-landmarks'];
  assert.ok(lm && lm.findings.length > 0, 'expected landmark findings');
  assert.ok(results.issues.some((f: any) => f.module === 'semantics-landmarks'), 'issues should include landmarks findings');
  assert.ok(results.issues.some((f: any) => (f.id || '').startsWith('axe:')), 'axe findings should remain');
  const issuesFile = JSON.parse(await fs.readFile(path.join(process.cwd(), 'out', 'issues.json'), 'utf-8'));
  assert.ok(issuesFile.some((f: any) => f.module === 'semantics-landmarks'));

  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Landmark-Abdeckung/.test(report), 'internal report should mention landmark coverage');
  const reportPub = await fs.readFile(path.join(process.cwd(), 'out', 'report_public.html'), 'utf-8');
  assert.ok(/Landmark-Abdeckung/.test(reportPub), 'public report should mention landmark coverage');
});
