export interface AxeViolation {
  id?: string;
  tags?: string[];
  helpUrl?: string;
  wcagRefs?: string[];
  bitvRefs?: string[];
  en301549Refs?: string[];
}

export interface AxeViolationWithNorms extends AxeViolation {
  wcagRefs: string[];
  bitvRefs: string[];
  en301549Refs: string[];
  inferredNorms?: boolean;
}

/**
 * Filtert aus axe-core Tags nur echte WCAG-Erfolgskriterien heraus.
 */
export function normalizeWcagTags(tags: string[] = [], helpUrl?: string): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const m = t.match(/^wcag(\d)(\d)(\d)([a-z])?$/i);
    if (m) out.add(`${m[1]}.${m[2]}.${m[3]}${m[4] || ''}`);
  }
  if (helpUrl) {
    const m = helpUrl.match(/wcag(\d)(\d)(\d)([a-z])?/i);
    if (m) out.add(`${m[1]}.${m[2]}.${m[3]}${m[4] || ''}`);
  }
  return Array.from(out);
}

const BITV_SUB: Record<string, string[]> = {
  '1.3.1': ['9.1.3.1a', '9.1.3.1b'],
};

export function deriveBitv(wcagIds: string[]): string[] {
  const out = new Set<string>();
  for (const id of wcagIds) {
    if (!id) continue;
    const mapped = BITV_SUB[id];
    if (mapped) mapped.forEach((m) => out.add(m));
    else out.add(`9.${id}`);
  }
  return Array.from(out);
}

export function deriveEn(wcagIds: string[]): string[] {
  const out = new Set<string>();
  for (const id of wcagIds) {
    if (typeof id === 'string' && id) out.add(`9.${id}`);
  }
  return Array.from(out);
}

export function enrichWithFallback(v: AxeViolation): AxeViolationWithNorms {
  const out = v as AxeViolationWithNorms;
  let inferred = false;
  if (!Array.isArray(out.wcagRefs) || out.wcagRefs.length === 0) {
    out.wcagRefs = normalizeWcagTags(out.tags || [], out.helpUrl);
    inferred = true;
  }
  if (!Array.isArray(out.bitvRefs) || out.bitvRefs.length === 0) {
    out.bitvRefs = deriveBitv(out.wcagRefs || []);
    inferred = true;
  }
  if (!Array.isArray(out.en301549Refs) || out.en301549Refs.length === 0) {
    out.en301549Refs = deriveEn(out.wcagRefs || []);
    inferred = true;
  }
  if (inferred) out.inferredNorms = true;
  return out;
}
