import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface NormAudit {
  total: number;
  missing: number;
  missingByRule: Record<string, number>;
}

export function auditIssues(issues: any[]): NormAudit {
  const summary: NormAudit = { total: issues.length, missing: 0, missingByRule: {} };
  for (const v of issues) {
    const hasW = Array.isArray(v.wcagRefs) && v.wcagRefs.length > 0;
    const hasB = Array.isArray(v.bitvRefs) && v.bitvRefs.length > 0;
    const hasE = Array.isArray(v.en301549Refs) && v.en301549Refs.length > 0;
    if (!(hasW && hasB && hasE)) {
      summary.missing++;
      summary.missingByRule[v.id || 'unknown'] = (summary.missingByRule[v.id || 'unknown'] || 0) + 1;
    }
  }
  return summary;
}

async function main() {
  const outDir = process.env.OUT_DIR || process.env.OUTPUT_DIR || path.join(process.cwd(), 'out');
  const issuesPath = path.join(outDir, 'issues.json');
  let issues: any[] = [];
  try {
    issues = JSON.parse(await fs.readFile(issuesPath, 'utf-8'));
  } catch {
    console.error('❌ issues.json nicht gefunden.');
    process.exit(1);
  }
  const summary = auditIssues(issues);
  await fs.writeFile(path.join(outDir, 'norm_audit.json'), JSON.stringify(summary, null, 2), 'utf-8');
  if (summary.missing > 0) {
    console.error(`❌ Normverweise fehlen bei ${summary.missing} Issue(s).`);
    process.exit(1);
  }
  console.log('✅ Normverweise vollständig.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
