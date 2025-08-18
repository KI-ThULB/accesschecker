import { promises as fs } from 'node:fs';
import path from 'node:path';

interface MappingEntry { axeRuleId: string; wcag?: string[]; bitv?: string[]; en301549?: string[]; }

function fromTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of tags || []) {
    const m = t.match(/^wcag(\d)(\d)(\d)$/i);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

function mapNorms(rule: any, mapping: Record<string, MappingEntry>, bitvMap: any, enMap: any) {
  const entry = mapping[rule.id] || {};
  let wcag: string[] = rule.wcagRefs || entry.wcag || [];
  if (!wcag.length) wcag = fromTags(rule.tags);
  let bitv: string[] = rule.bitvRefs || entry.bitv || [];
  let en: string[] = rule.en301549Refs || entry.en301549 || [];
  if (!bitv.length) bitv = wcag.map((w: string) => bitvMap[w] || (bitvMap._prefix ? bitvMap._prefix + w : undefined)).filter(Boolean);
  if (!en.length) en = wcag.map((w: string) => enMap[w] || (enMap._prefix ? enMap._prefix + w : undefined)).filter(Boolean);
  return { wcag, bitv, en, ok: wcag.length && bitv.length && en.length };
}

async function main() {
  const outDir = path.join(process.cwd(), 'out');
  let issues: any[] = [];
  try {
    issues = JSON.parse(await fs.readFile(path.join(outDir, 'issues.json'), 'utf-8'));
  } catch {
    console.warn('⚠️  Keine issues.json gefunden – Normen-Audit übersprungen.');
    return;
  }
  const mapArr: MappingEntry[] = JSON.parse(await fs.readFile(new URL('../config/rules_mapping.json', import.meta.url), 'utf-8'));
  const bitvMap = JSON.parse(await fs.readFile(new URL('../config/norm_maps/bitv.json', import.meta.url), 'utf-8'));
  const enMap = JSON.parse(await fs.readFile(new URL('../config/norm_maps/en.json', import.meta.url), 'utf-8'));
  const byId: Record<string, MappingEntry> = {};
  for (const m of mapArr) byId[m.axeRuleId] = m;
  const seen = new Set<string>();
  const warnings: any[] = [];
  for (const v of issues) {
    if (seen.has(v.id)) continue; seen.add(v.id);
    const norm = mapNorms(v, byId, bitvMap, enMap);
    if (!norm.ok) {
      warnings.push({ rule: v.id, wcag: norm.wcag, bitv: norm.bitv, en: norm.en });
    }
  }
  await fs.writeFile(path.join(outDir, 'norm_audit.json'), JSON.stringify(warnings, null, 2), 'utf-8');
  if (warnings.length) {
    console.error('❌ Fehlende Normverweise:', warnings.length);
    process.exit(1);
  }
  console.log('✅ Normverweise vollständig.');
}

main().catch((e)=>{ console.error(e); process.exit(1); });
