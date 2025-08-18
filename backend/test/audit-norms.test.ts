import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const script = path.resolve('scripts/audit-norms.ts');

function run(outDir: string) {
  const res = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: path.resolve('.'),
    env: { ...process.env, OUT_DIR: outDir },
    encoding: 'utf-8'
  });
  return res;
}

test('audit-norms flags missing references', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const outDir = path.join(tmp);
  mkdirSync(outDir, { recursive: true });
  const issues = [
    { id: 'complete', wcagRefs: ['1.1.1'], bitvRefs: ['9.1.1.1'], en301549Refs: ['9.1.1.1'] },
    { id: 'missing', wcagRefs: [], bitvRefs: [], en301549Refs: [] }
  ];
  writeFileSync(path.join(outDir, 'issues.json'), JSON.stringify(issues, null, 2));
  const res = run(outDir);
  assert.notStrictEqual(res.status, 0);
  const audit = JSON.parse(readFileSync(path.join(outDir, 'norm_audit.json'), 'utf-8'));
  assert.equal(audit.missing, 1);
  assert.equal(audit.missingByRule.missing, 1);
});
