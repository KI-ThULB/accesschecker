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

export function deriveBitv(wcagIds: string[]): string[] {
  const out = new Set<string>();
  for (const id of wcagIds) {
    if (typeof id === 'string' && id) out.add(`9.${id}`);
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

export function enrichWithFallback(v: any) {
  const hasW = Array.isArray(v.wcagRefs) && v.wcagRefs.length > 0;
  const hasB = Array.isArray(v.bitvRefs) && v.bitvRefs.length > 0;
  const hasE = Array.isArray(v.en301549Refs) && v.en301549Refs.length > 0;
  if (hasW && hasB && hasE) return v;
  const wcag = normalizeWcagTags(v.tags || [], v.helpUrl);
  v.wcagRefs = wcag;
  v.bitvRefs = deriveBitv(wcag);
  v.en301549Refs = deriveEn(wcag);
  return v;
}
