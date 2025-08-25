import { test } from 'node:test';
import assert from 'node:assert';
import { main as engineMain } from '../core/engine.js';

const DATA = (html: string) => 'data:text/html,' + encodeURIComponent(html);

async function run(html: string) {
  const url = DATA(html);
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', url, '--profile', 'fast']);
  try {
    return await engineMain();
  } finally {
    process.argv = orig;
  }
}

test('valid early skip link yields no findings', async () => {
  const html = `<a href="#main" class="skip-link">Skip to content</a><main id="main" tabindex="-1"><p>Hi</p></main>`;
  const res = await run(html);
  const mod = res.modules['skiplinks'];
  assert.equal(mod.stats.total, 1);
  assert.equal(mod.stats.valid, 1);
  assert.ok(!mod.findings.some((f:any)=>f.id.startsWith('skiplinks:')));
});

test('missing target produces finding', async () => {
  const html = `<a href="#main">Skip</a><div id="content"></div>`;
  const res = await run(html);
  const mod = res.modules['skiplinks'];
  assert.ok(mod.findings.some((f:any)=>f.id==='skiplinks:target-missing'));
  assert.equal(mod.stats.targetMissing, 1);
});

test('late skip link flagged', async () => {
  const html = `<a href="#a">a</a><a href="#b">b</a><a href="#c">c</a><a href="#d">d</a><a href="#e">e</a><a href="#main">Skip</a><main id="main" tabindex="-1"></main>`;
  const res = await run(html);
  const mod = res.modules['skiplinks'];
  assert.ok(mod.findings.some((f:any)=>f.id==='skiplinks:late'));
  assert.equal(mod.stats.late, 1);
});

test('missing skip link yields skiplinks:missing', async () => {
  const html = `<p>No skip link here</p>`;
  const res = await run(html);
  const mod = res.modules['skiplinks'];
  assert.ok(mod.findings.some((f:any)=>f.id==='skiplinks:missing'));
  assert.equal(mod.stats.total, 0);
});

test('e2e BAD demo site has skip link', async (t) => {
  const url = 'https://www.w3.org/WAI/demos/bad/';
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', url, '--profile', 'fast']);
  let res: any;
  try {
    res = await engineMain();
  } catch (e) {
    t.skip(`Engine run failed: ${e}`);
    process.argv = orig;
    return;
  }
  process.argv = orig;
  const mod = res.modules['skiplinks'];
  assert.ok(mod.stats.total >= 1);
  const overviewPath = mod.artifacts?.overview;
  if (overviewPath) {
    const list = await import('node:fs/promises').then(fs => fs.readFile(overviewPath, 'utf-8').then(JSON.parse).catch(()=>[]));
    assert.ok(Array.isArray(list) && list.length >= 1);
  }
});
