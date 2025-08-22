import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mod from '../modules/keyboard-visibility/index.js';
import { ModuleContext } from '../core/types.js';

async function runOn(html: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const ctx: ModuleContext = {
    page,
    url: '',
    crawlGraph: [],
    config: { profile: 'test', modules: {}, profiles: {} },
    log: () => {},
    saveArtifact: async (name, data) => {
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const file = path.join(process.cwd(), 'out', `${unique}_${name}`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(data));
      return file;
    }
  } as any;
  const res = await mod.run(ctx);
  await browser.close();
  return res;
}

test('outline none -> keyboard:outline-suppressed', async () => {
  const res = await runOn('<button style="outline: none">A</button>');
  assert.ok(res.findings.some(f => f.id === 'keyboard:outline-suppressed'));
});

test('weak shadow -> keyboard:focus-indicator-weak', async () => {
  const res = await runOn('<button style="outline: none; box-shadow: 0 0 0 1px rgba(0,0,0,0.2)">B</button>');
  assert.ok(res.findings.some(f => f.id === 'keyboard:focus-indicator-weak'));
});

test('tabindex=5 -> keyboard:tabindex-gt-zero', async () => {
  const res = await runOn('<div tabindex="5">X</div>');
  assert.ok(res.findings.some(f => f.id === 'keyboard:tabindex-gt-zero'));
});

test('tab order anomaly detected', async () => {
  const res = await runOn('<div id="a">A</div><div id="b" tabindex="1">B</div><div id="c">C</div>');
  assert.ok(res.findings.some(f => f.id === 'keyboard:tab-order-anomaly'));
  const f = res.findings.find(f => f.id === 'keyboard:tab-order-anomaly');
  assert.match(f?.details || '', /Sprung von/);
});
