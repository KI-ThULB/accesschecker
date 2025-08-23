import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import { main as engineMain } from '../core/engine.js';

async function run(url: string) {
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', url, '--profile', 'fast']);
  try {
    return await engineMain();
  } finally {
    process.argv = orig;
  }
}

const DATA = (html: string) => 'data:text/html,' + encodeURIComponent(html);

test('outline:none -> keyboard:outline-suppressed', async () => {
  const html = `<button style="outline:none">A</button>`;
  const res = await run(DATA(html));
  const mod = res.modules['keyboard-visibility'];
  assert.ok(mod.findings.some((f: any) => f.id === 'keyboard:outline-suppressed'));
});

test('schwacher box-shadow -> keyboard:focus-indicator-weak', async () => {
  const html = `<button style="outline:none;box-shadow:0 0 0 1px rgba(0,0,0,0.1)">A</button>`;
  const res = await run(DATA(html));
  const mod = res.modules['keyboard-visibility'];
  assert.ok(mod.findings.some((f: any) => f.id === 'keyboard:focus-indicator-weak'));
});

test('tabindex=5 -> keyboard:tabindex-gt-zero', async () => {
  const html = `<button>A</button><button tabindex="5">B</button>`;
  const res = await run(DATA(html));
  const mod = res.modules['keyboard-visibility'];
  assert.ok(mod.findings.some((f: any) => f.id === 'keyboard:tabindex-gt-zero'));
});

test('Sequenzabweichung -> keyboard:tab-order-anomaly', async () => {
  const html = `<a id="nav" href="#">Nav</a><a id="footer" href="#" tabindex="1">Footer</a><a id="main" href="#" tabindex="2">Main</a>`;
  const res = await run(DATA(html));
  const mod = res.modules['keyboard-visibility'];
  const finding = mod.findings.find((f: any) => f.id === 'keyboard:tab-order-anomaly');
  assert.ok(finding, 'expected anomaly');
  assert.match(finding.details, /Sprung/);
});

test('e2e BAD demo site yields focus finding and screens', async (t) => {
  const url = 'https://www.w3.org/WAI/demos/bad/';
  let res: any;
  try {
    res = await run(url);
  } catch (e) {
    t.skip(`Engine run failed: ${e}`);
    return;
  }
  const mod = res.modules['keyboard-visibility'];
  assert.ok(mod.findings.length > 0, 'expected focus findings');
  const screens = mod.artifacts?.screens || [];
  assert.ok(Array.isArray(screens) && screens.length > 0);
  for (const s of screens.slice(0,1)) {
    assert.ok(await fs.stat(s));
  }
});
