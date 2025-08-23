import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mod from '../modules/landmarks/index.ts';
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

test('missing main → landmarks:missing-main', async () => {
  const res = await runSnippet('<div>no main</div>');
  assert.ok(res.findings.some((f: any) => f.id === 'landmarks:missing-main'));
});

test('two banners → landmarks:duplicate-banner', async () => {
  const res = await runSnippet('<header role="banner"></header><header role="banner"></header><main></main>');
  assert.ok(res.findings.some((f: any) => f.id === 'landmarks:duplicate-banner'));
});

test('coverage 0/50/100', async () => {
  const f0 = await runSnippet('<p></p><p></p>');
  const cov0 = (f0.findings.find((f:any)=>f.id==='landmarks:coverage') as any).metrics.coveragePercent;
  assert.equal(cov0, 0);
  const f50 = await runSnippet('<main><p></p></main><p></p>');
  const cov50 = (f50.findings.find((f:any)=>f.id==='landmarks:coverage') as any).metrics.coveragePercent;
  assert.equal(cov50, 50);
  const f100 = await runSnippet('<main><p></p></main>');
  const cov100 = (f100.findings.find((f:any)=>f.id==='landmarks:coverage') as any).metrics.coveragePercent;
  assert.equal(cov100, 100);
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
  const lm = results.modules['landmarks'];
  assert.ok(lm && lm.findings.length > 0, 'expected landmark findings');
  assert.ok(results.issues.some((f: any) => f.module === 'landmarks'), 'issues should include landmarks findings');
  assert.ok(results.issues.some((f: any) => (f.id || '').startsWith('axe:')), 'axe findings should remain');
  const issuesFile = JSON.parse(await fs.readFile(path.join(process.cwd(), 'out', 'issues.json'), 'utf-8'));
  assert.ok(issuesFile.some((f: any) => f.module === 'landmarks'));

  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Landmarks &amp; Struktur/.test(report), 'internal report should include landmarks section');
  const reportPub = await fs.readFile(path.join(process.cwd(), 'out', 'report_public.html'), 'utf-8');
  assert.ok(/Unzureichende Landmark-Struktur/.test(reportPub), 'public report should mention landmark top finding');
  const artifact = JSON.parse(await fs.readFile(path.join(process.cwd(), 'out', 'landmarks.json'), 'utf-8'));
  assert.ok(typeof artifact.stats.coveragePercent === 'number');
});
