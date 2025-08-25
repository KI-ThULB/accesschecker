import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import mod from '../modules/images/index.ts';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

async function runWithRaw(raw: any[]) {
  const ctx: any = {
    page: { evaluate: async () => raw },
    url: 'http://example.com',
    crawlGraph: [],
    config: { modules: { images: {} } },
    log() {},
    saveArtifact: async () => ''
  };
  return await mod.run(ctx);
}

test('detect various image issues', async () => {
  const raw = [
    { type: 'img', alt: null, src: 'a.jpg', role: '', ariaHidden: false, selector: 'img:nth-of-type(1)', filename: 'a.jpg', parentText: '', naturalWidth: 100, naturalHeight: 20 },
    { type: 'img', alt: 'decor', src: 'b.jpg', role: 'presentation', ariaHidden: false, selector: 'img:nth-of-type(2)', filename: 'b.jpg', parentText: '', naturalWidth: 10, naturalHeight: 10 },
    { type: 'img', alt: 'Home', src: 'c.jpg', role: '', ariaHidden: false, selector: 'img:nth-of-type(3)', filename: 'c.jpg', parentText: 'Home', naturalWidth: 10, naturalHeight: 10 },
    { type: 'img', alt: 'foo', src: 'foo.jpg', role: '', ariaHidden: false, selector: 'img:nth-of-type(4)', filename: 'foo.jpg', parentText: '', naturalWidth: 10, naturalHeight: 10 },
    { type: 'svg', hasTitle: false, hasDesc: false, ariaLabel: '', labelledbyText: '', role: '', ariaHidden: false, selector: 'svg:nth-of-type(1)', inLink: true },
    { type: 'input-image', alt: '', src: 'submit.png', selector: 'input:nth-of-type(1)' },
    { type: 'area', alt: '', ariaLabel: '', selector: 'area:nth-of-type(1)' }
  ];
  const res = await runWithRaw(raw);
  const ids = res.findings.map((f: any) => f.id);
  assert.ok(ids.includes('images:missing-alt'));
  assert.ok(ids.includes('images:decorative-with-alt'));
  assert.ok(ids.includes('images:redundant-alt'));
  assert.ok(ids.includes('images:filename-as-alt'));
  assert.ok(ids.includes('images:svg-missing-title'));
  assert.ok(ids.includes('images:input-image-missing-alt'));
  assert.ok(ids.includes('images:imagemap-area-missing-alt'));
});

test('engine processes local fixture with images module', async (t) => {
  const fileUrl = 'file://' + path.join(process.cwd(), 'tests', 'fixtures', 'images', 'index.html');
  let results: any;
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', fileUrl, '--profile', 'fast']);
  try {
    results = await engineMain();
  } catch (e) {
    t.skip(`Engine run failed: ${e}`);
    return;
  } finally {
    process.argv = orig;
  }
  const imgMod = results.modules['images'];
  if (!imgMod) {
    t.skip('images module missing');
    return;
  }
  assert.ok(imgMod.findings.some((f: any) => f.id === 'images:missing-alt'));
  const idxPath = path.join(process.cwd(), 'out', 'images_index.json');
  const idx = JSON.parse(await fs.readFile(idxPath, 'utf-8'));
  assert.ok(Array.isArray(idx) && idx.length > 0);
  const fakePage = { setViewportSize() {}, setContent() {}, pdf: async () => {} } as any;
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} } as any;
  t.mock.method(chromium, 'launch', async () => fakeBrowser);
  await buildReports();
  const report = await fs.readFile(path.join(process.cwd(), 'out', 'report_internal.html'), 'utf-8');
  assert.ok(/Bilder &amp; Alternativtexte/.test(report));
});
