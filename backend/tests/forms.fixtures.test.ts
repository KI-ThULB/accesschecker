import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import mod from '../modules/forms/index.ts';
import { getNameInfo } from '../src/a11y/name.ts';

async function runFixture(file: string) {
  const html = await fs.readFile(path.join(process.cwd(), 'tests', 'fixtures', 'forms', file), 'utf-8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  // inject helper used by collectFormControls
  await page.addScriptTag({ content: `${getNameInfo.toString()}` });
  const artifacts: Record<string, any> = {};
  const ctx: any = { page, url: 'http://example.com', crawlGraph: [], config: { modules: { forms: {} } }, log() {}, saveArtifact: async (name: string, data: any) => { artifacts[name] = data; return name; } };
  const res = await mod.run(ctx);
  await browser.close();
  return { res, artifacts };
}

test('a-ok.html yields no findings and creates overview artifact', async () => {
  const { res, artifacts } = await runFixture('a-ok.html');
  assert.strictEqual(res.findings.length, 0);
  const overview = artifacts['forms_overview.json'];
  assert.ok(Array.isArray(overview) && overview.length > 0);
  const first = overview[0];
  assert.ok('type' in first && 'labels' in first);
});

test('missing-label.html reports missing-label', async () => {
  const { res } = await runFixture('missing-label.html');
  assert.strictEqual(res.findings.length, 1);
  assert.ok(res.findings.some((f: any) => f.id === 'forms:missing-label'));
});

test('multiple-labels.html reports multiple-labels', async () => {
  const { res } = await runFixture('multiple-labels.html');
  assert.strictEqual(res.findings.length, 1);
  assert.ok(res.findings.some((f: any) => f.id === 'forms:multiple-labels'));
});

test('error-not-associated.html reports error-not-associated', async () => {
  const { res } = await runFixture('error-not-associated.html');
  assert.strictEqual(res.findings.length, 1);
  assert.ok(res.findings.some((f: any) => f.id === 'forms:error-not-associated'));
});

test('required-not-indicated.html reports required-not-indicated', async () => {
  const { res } = await runFixture('required-not-indicated.html');
  assert.strictEqual(res.findings.length, 1);
  assert.ok(res.findings.some((f: any) => f.id === 'forms:required-not-indicated'));
});

test('radio-group-no-fieldset.html reports missing-fieldset-legend', async () => {
  const { res } = await runFixture('radio-group-no-fieldset.html');
  assert.strictEqual(res.findings.length, 1);
  assert.ok(res.findings.some((f: any) => f.id === 'forms:missing-fieldset-legend'));
});

test('autocomplete-wrong.html reports autocomplete-missing-or-wrong', async () => {
  const { res } = await runFixture('autocomplete-wrong.html');
  assert.strictEqual(res.findings.length, 1);
  assert.ok(res.findings.some((f: any) => f.id === 'forms:autocomplete-missing-or-wrong'));
});
