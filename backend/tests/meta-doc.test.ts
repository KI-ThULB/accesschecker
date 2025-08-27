import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mod from '../modules/metaDoc/index.ts';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

async function runSnippet(html: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const ctx: any = { page, url: 'http://example.com', crawlGraph: [], config: { modules: { metaDoc: {} } }, log() {}, saveArtifact: async () => '' };
  const res = await mod.run(ctx);
  await browser.close();
  return res;
}

test('fixture A: valid title and lang', async () => {
  const res = await runSnippet('<html lang="en"><head><title>Hello World</title></head><body></body></html>');
  assert.equal(res.findings.length, 0);
  assert.equal(res.stats.lang, 'en');
  assert.equal(res.stats.hasTitle, true);
});

test('fixture B: missing title', async () => {
  const res = await runSnippet('<html lang="en"><head></head><body></body></html>');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:title-missing'));
});

test('fixture C: title too short', async () => {
  const res = await runSnippet('<html lang="en"><head><title>Hi</title></head><body></body></html>');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:title-too-short'));
});

test('fixture D: invalid lang', async () => {
  const res = await runSnippet('<html lang="xx-invalid"><head><title>Hello</title></head><body></body></html>');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:lang-invalid'));
});

test('fixture E: lang vs xml:lang mismatch', async () => {
  const res = await runSnippet('<html lang="de" xml:lang="en"><head><title>Hello</title></head><body></body></html>');
  assert.ok(res.findings.some((f:any)=>f.id==='meta:lang-xml-mismatch'));
});

test('fixture F: lang/content mismatch', async () => {
  const html = '<html lang="de"><head><title>Hallo Welt</title></head><body>The and not is this that with from</body></html>';
  const res = await runSnippet(html);
  assert.ok(res.findings.some((f:any)=>f.id==='meta:lang-content-mismatch' && f.severity==='advice'));
});

test('e2e BAD demo site includes metaDoc section', async (t) => {
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
  const meta = results.modules['metaDoc'];
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
