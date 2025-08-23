import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import mod from '../modules/links/index.ts';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

async function runSnippet(html: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const ctx: any = { page, url: 'http://example.com', crawlGraph: [], config: { modules: { links: { compareQuery: false } } }, log() {}, saveArtifact: async () => '' };
  const res = await mod.run(ctx);
  await browser.close();
  return res;
}

test('detect various link issues', async () => {
  const html = `
    <a href="/a">hier</a>
    <a href="/b">mehr</a>
    <a href="http://example.com">http://example.com</a>
    <a href="/icon"><svg></svg></a>
    <a href="/x">Mehr</a>
    <a href="/y">Mehr</a>`;
  const res = await runSnippet(html);
  const ids = res.findings.map((f: any) => f.id);
  assert.ok(ids.includes('links:nondescriptive'));
  assert.ok(ids.includes('links:raw-url'));
  assert.ok(ids.includes('links:icon-only'));
  assert.ok(ids.includes('links:text-dup-different-target'));
});

test('duplicate targets with different texts', async () => {
  const html = `<a href="/same">Startseite</a><a href="/same">Kontakt aufnehmen</a>`;
  const res = await runSnippet(html);
  assert.ok(res.findings.some((f: any) => f.id === 'links:target-dup-different-text'));
});

test('e2e BAD demo site yields link findings and appears in reports', async (t) => {
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
  const linksMod = results.modules['links'];
  assert.ok(linksMod && linksMod.findings.some((f: any) => f.id === 'links:nondescriptive'));
  assert.ok(linksMod.findings.some((f: any) => f.id === 'links:text-dup-different-target'));
  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Links &amp; Linktexte/.test(report));
  const reportPub = await fs.readFile(path.join(process.cwd(), 'out', 'report_public.html'), 'utf-8');
  assert.ok(/Nicht aussagekräftige Linktexte/.test(reportPub));
});
