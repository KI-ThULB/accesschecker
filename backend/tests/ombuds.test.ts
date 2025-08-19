import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { loadOmbudsConfig, resolveJurisdiction, getEntry } from '../scripts/lib/ombuds.js';
import { main as buildReports } from '../scripts/build-reports.js';
import { chromium } from 'playwright';

const CONFIG_PATH = path.resolve('config/ombudspersons.json');

test('validation fails for wrong structure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ombuds-invalid-'));
  const file = path.join(dir, 'ombudspersons.json');
  await fs.writeFile(file, JSON.stringify({ version: "x" }));
  await assert.rejects(() => loadOmbudsConfig(file));
});

test('resolveJurisdiction prefers override', async () => {
  await loadOmbudsConfig(CONFIG_PATH);
  const j = resolveJurisdiction({ configOverride: 'DE-TH', fromDomain: 'https://example.org' });
  assert.strictEqual(j, 'DE-TH');
});

test('getEntry falls back to default', async () => {
  const cfg = await loadOmbudsConfig(CONFIG_PATH);
  const entry = getEntry('DE-XX');
  assert.strictEqual(entry.jurisdiction, cfg.defaultJurisdiction);
});

test('report build produces enforcement block and hint', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'report-'));
  const outDir = path.join(tmp, 'out');
  await fs.mkdir(outDir, { recursive: true });
  const now = new Date().toISOString();
  const summary = {
    startUrl: 'https://example.org',
    date: now,
    pagesCrawled: 0,
    downloadsFound: 0,
    score: { overall: 100, bySeverity: { critical:0, serious:0, moderate:0, minor:0 } },
    totals: { violations:0, incomplete:0 },
    jurisdiction: 'DE-TH'
  };
  await fs.writeFile(path.join(outDir, 'scan.json'), JSON.stringify(summary));
  await fs.writeFile(path.join(outDir, 'issues.json'), '[]');
  await fs.writeFile(path.join(outDir, 'downloads_report.json'), '[]');
  await fs.writeFile(path.join(outDir, 'dynamic_interactions.json'), '[]');

  const cfgDir = path.join(tmp, 'config');
  await fs.mkdir(path.join(cfgDir, 'schemas'), { recursive: true });
  await fs.copyFile(CONFIG_PATH, path.join(cfgDir, 'ombudspersons.json'));
  await fs.copyFile(path.resolve('config/schemas/ombudspersons.schema.json'), path.join(cfgDir, 'schemas', 'ombudspersons.schema.json'));
  await fs.writeFile(path.join(cfgDir, 'public_statement.profile.json'), JSON.stringify({ organisationName: 'Test' }));

  const fakePage = { setViewportSize(){}, setContent(){}, pdf: async ()=>{} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async ()=>{} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);

  const oldCwd = process.cwd();
  process.chdir(tmp);
  process.env.OUTPUT_DIR = outDir;
  try {
    await buildReports();
  } finally {
    process.chdir(oldCwd);
    delete process.env.OUTPUT_DIR;
  }

  const statement = JSON.parse(await fs.readFile(path.join(outDir, 'public_statement.json'), 'utf-8'));
  assert.ok(statement.enforcement && statement.enforcement.label);
  assert.strictEqual(statement.enforcement.jurisdiction, 'DE-TH');
  assert.strictEqual(statement.enforcementDataStatus, 'incomplete');

  const html = await fs.readFile(path.join(outDir, 'report_public.html'), 'utf-8');
  assert.ok(html.includes('Die Kontaktdaten der zuständigen Durchsetzungsstelle werden kurzfristig ergänzt'));
});
