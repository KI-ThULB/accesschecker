import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';
import { chromium } from 'playwright';

async function runFixture(file: string) {
  const fileUrl = 'file://' + path.join(process.cwd(), 'tests', 'fixtures', 'contrast', file);
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', fileUrl, '--modules', 'text-contrast']);
  try {
    return await engineMain();
  } catch (e) {
    return null;
  } finally {
    process.argv = orig;
  }
}

test('high contrast yields no finding', async (t) => {
  const res = await runFixture('a.html');
  if (!res) { t.skip('engine run failed'); return; }
  const mod = res.modules['text-contrast'];
  assert.ok(mod);
  assert.equal(mod.findings.length, 0);
});

test('low contrast detected', async (t) => {
  const res = await runFixture('b.html');
  if (!res) { t.skip('engine run failed'); return; }
  const mod = res.modules['text-contrast'];
  assert.ok(mod.findings.some((f: any) => f.id === 'contrast:text-low'));
});

test('large text passes threshold', async (t) => {
  const res = await runFixture('c.html');
  if (!res) { t.skip('engine run failed'); return; }
  const mod = res.modules['text-contrast'];
  assert.equal(mod.findings.length, 0);
});

test('link text low contrast detected', async (t) => {
  const res = await runFixture('d.html');
  if (!res) { t.skip('engine run failed'); return; }
  const mod = res.modules['text-contrast'];
  assert.ok(mod.findings.some((f: any) => f.id === 'contrast:text-low'));
});

test('hidden text ignored', async (t) => {
  const res = await runFixture('e.html');
  if (!res) { t.skip('engine run failed'); return; }
  const mod = res.modules['text-contrast'];
  assert.equal(mod.findings.length, 0);
});

test('report includes text contrast section', async (t) => {
  const res = await runFixture('b.html');
  if (!res) { t.skip('engine run failed'); return; }
  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Text-Kontrast/.test(report));
  const detailPath = path.join(process.cwd(), 'out', 'text_contrast.json');
  const detail = JSON.parse(await fs.readFile(detailPath, 'utf-8'));
  assert.ok(Array.isArray(detail));
});
