import { describe, it, expect } from 'vitest';
import { normalizeWcagTags, deriveBitv, deriveEn, enrichWithFallback } from '../scripts/lib/norms.js';

describe('norms', () => {
  it('normalizes axe tags to WCAG ids', () => {
    const tags = ['wcag111', 'wcag131b', 'WCAG242', 'random', 'wcag2a'];
    expect(normalizeWcagTags(tags)).toEqual(['1.1.1', '1.3.1b', '2.4.2']);
  });

  it('derives BITV and EN from WCAG ids', () => {
    const ids = ['1.3.1'];
    expect(deriveBitv(ids)).toEqual(['9.1.3.1a', '9.1.3.1b']);
    expect(deriveEn(ids)).toEqual(['9.1.3.1']);
  });

  it('enriches violation with inferred norms', () => {
    const v = { id: 'test', tags: ['wcag111'] } as any;
    const enriched = enrichWithFallback(v);
    expect(enriched.wcagRefs).toEqual(['1.1.1']);
    expect(enriched.bitvRefs).toEqual(['9.1.1.1']);
    expect(enriched.en301549Refs).toEqual(['9.1.1.1']);
    expect(enriched.inferredNorms).toBe(true);
  });
});
