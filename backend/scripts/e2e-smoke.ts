import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(url: string) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'acs-e2e-'));
  execSync(`node --loader tsx scripts/crawl-scan.ts`, {
    cwd: path.resolve('.'),
    stdio: 'inherit',
    env: { ...process.env, START_URL: url, OUTPUT_DIR: outDir, MAX_PAGES: '5', MAX_DEPTH: '2', DOWNLOADS_ENABLED: 'false', DYNAMIC_INTERACTIONS: 'false' }
  });
  return JSON.parse(readFileSync(path.join(outDir, 'issues.json'), 'utf-8'));
}

async function main() {
  const beforeIssues = run('https://www.w3.org/WAI/demos/bad/before/home.html');
  const afterIssues = run('https://www.w3.org/WAI/demos/bad/after/home.html');
  const combined = beforeIssues.concat(afterIssues);
  const hasRegion = beforeIssues.some((v: any) => v.id === 'region');
  const hasMain = beforeIssues.some((v: any) => v.id === 'landmark-one-main');
  const hasFormTable = combined.some((v: any) => ['label', 'select-name', 'empty-table-header', 'td-headers-attr'].includes(v.id));
  if (!hasRegion || !hasMain || !hasFormTable) {
    throw new Error('required rules missing');
  }
  console.log('e2e smoke passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
