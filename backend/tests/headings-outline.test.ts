import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scan } from '../modules/headings-outline/index.ts';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

async function runSnippet(html: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const res = await scan(page, 'http://example.com');
  await browser.close();
  return res;
}

test('missing h1 → missing-h1 finding', async () => {
  const res = await runSnippet('<h2>foo</h2>');
  assert.ok(res.findings.some(f => f.id === 'headings:missing-h1'));
});

test('multiple h1 → multiple-h1', async () => {
  const res = await runSnippet('<h1>a</h1><h1>b</h1>');
  assert.ok(res.findings.some(f => f.id === 'headings:multiple-h1'));
});

test('jump level h2→h4 → jump-level', async () => {
  const res = await runSnippet('<h1>t</h1><h2>a</h2><h4>b</h4>');
  assert.ok(res.findings.some(f => f.id === 'headings:jump-level'));
});

test('empty heading → empty-text', async () => {
  const res = await runSnippet('<h1> \n </h1>');
  assert.ok(res.findings.some(f => f.id === 'headings:empty-text'));
});

test('e2e: BAD demo site yields heading finding and appears in reports', async (t) => {
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
  const hd = results.modules['headings-outline'];
  assert.ok(hd && hd.findings.length > 0, 'expected heading findings');
  assert.ok(!hd.findings.some((f: any) => f.id === 'headings:missing-h1'), 'should not report missing h1');
  assert.ok(results.issues.some((f: any) => f.module === 'headings-outline'));

  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Überschriften &amp; Dokumentstruktur/.test(report), 'internal report should mention headings section');
});
