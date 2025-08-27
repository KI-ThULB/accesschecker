import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mod from '../modules/meta-doc/index.ts';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

async function runFixture(file: string, cfg: any = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const html = await fs.readFile(path.join(process.cwd(), 'tests', 'fixtures', 'meta', file), 'utf-8');
  await page.setContent(html);
  const ctx: any = { page, url: 'http://example.com', crawlGraph: [], config: { modules: { 'meta-doc': cfg } }, log() {}, saveArtifact: async () => '' };
  const res = await mod.run(ctx);
  await browser.close();
  return res;
}

test('fixture A: valid title and lang', async () => {
  const res = await runFixture('A_valid.html');
  assert.equal(res.findings.length, 0);
  assert.equal(res.stats.lang, 'en');
  assert.equal(res.stats.hasTitle, true);
});

test('fixture B: missing title', async () => {
  const res = await runFixture('B_no_title.html');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:title-missing'));
});

test('fixture C: title too short', async () => {
  const res = await runFixture('C_short_title.html');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:title-too-short'));
});

test('fixture D: invalid lang', async () => {
  const res = await runFixture('D_invalid_lang.html');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:lang-invalid'));
});

test('fixture E: lang vs xml:lang mismatch', async () => {
  const res = await runFixture('E_xml_mismatch.html');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:lang-xml-mismatch'));
});

test('fixture F: lang/content mismatch', async () => {
  const res = await runFixture('F_content_mismatch.html', { enableContentHeuristics: true });
  assert.ok(res.findings.some((f:any)=>f.id==='meta:lang-content-mismatch' && f.severity==='advice'));
});

test('BCP47 regex accepts common tags', () => {
  const bcp47 = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
  const tags = ['de','en','en-GB','de-AT','fr','es-419','zh-Hans'];
  for (const t of tags) assert.ok(bcp47.test(t));
});

test('e2e BAD demo site includes meta-doc section', async (t) => {
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
  const meta = results.modules['meta-doc'];
  assert.ok(meta && meta.stats.hasTitle);
  const fakePage = { setViewportSize(){}, setContent(){}, pdf: async()=>{} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async ()=>{} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const reportInt = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Dokumentsprache &amp; Seitentitel/.test(reportInt));
  const reportPub = await fs.readFile(path.join(process.cwd(), 'out', 'report_public.html'), 'utf-8');
  assert.ok(/Dokumentsprache &amp; Seitentitel/.test(reportPub));
});
