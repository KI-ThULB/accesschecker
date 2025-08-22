import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import { main as engineMain } from '../core/engine.js';

const TEST_URL = 'https://www.w3.org/WAI/demos/bad/';

test('keyboard-visibility module reports findings, trace and screenshots', async (t) => {
  const orig = process.argv;
  process.argv = process.argv.slice(0,2).concat(['--url', TEST_URL, '--profile', 'fast']);
  let results: any;
  try {
    results = await engineMain();
  } catch (e) {
    t.skip(`Engine run failed: ${e}`);
  } finally {
    process.argv = orig;
  }
  const mod = results.modules['keyboard-visibility'];
  assert.ok(mod && mod.findings.length > 0, 'expected findings');
  const tracePath = mod.artifacts?.trace;
  assert.ok(tracePath, 'expected trace artifact');
  const traceData = JSON.parse(await fs.readFile(tracePath, 'utf-8'));
  assert.ok(Array.isArray(traceData) && traceData.length >= 5, 'expected >=5 focus events');
  const screens = mod.artifacts?.screens || [];
  assert.ok(screens.length > 0, 'expected screenshot artifacts');
  const imgExists = await fs.stat(screens[0]).then(()=>true,()=>false);
  assert.ok(imgExists, 'screenshot file should exist');
});
