import type { Module, Finding } from '../../core/types.js';
import type { Page } from 'playwright';

export interface HeadingNode {
  level: 1|2|3|4|5|6;
  text: string;
  id?: string;
  roleHeading?: boolean;
}
export interface HeadingsFinding {
  id: string;
  severity: 'minor'|'moderate'|'serious';
  summary: string;
  details?: string;
  selectors: string[];
  pageUrl: string;
  norms?: { wcag?: string[]; bitv?: string[] };
}
export interface HeadingsResult {
  module: 'headings-outline';
  version: string;
  outline: HeadingNode[];
  findings: HeadingsFinding[];
  stats: {
    hasH1: boolean;
    multipleH1: boolean;
    maxDepth: number;
    jumps: number;
  };
}

function cssPath(el: Element): string {
  if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
  const parts: string[] = [];
  let e: Element | null = el;
  while (e && parts.length < 4) {
    let part = e.tagName.toLowerCase();
    let sib = e.previousElementSibling;
    let count = 1;
    while (sib) { if (sib.tagName === e.tagName) count++; sib = sib.previousElementSibling; }
    part += `:nth-of-type(${count})`;
    parts.unshift(part);
    e = e.parentElement;
  }
  return parts.join('>');
}

export async function scan(page: Page, pageUrl: string): Promise<HeadingsResult> {
  const raw = await page.evaluate(() => {
    function cssPathEval(el: Element): string {
      if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
      const parts: string[] = [];
      let e: Element | null = el;
      while (e && parts.length < 4) {
        let part = e.tagName.toLowerCase();
        let sib = e.previousElementSibling;
        let count = 1;
        while (sib) { if (sib.tagName === e.tagName) count++; sib = sib.previousElementSibling; }
        part += `:nth-of-type(${count})`;
        parts.unshift(part);
        e = e.parentElement;
      }
      return parts.join('>');
    }
    const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"][aria-level]')) as HTMLElement[];
    const data: any[] = [];
    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const roleHeading = el.getAttribute('role') === 'heading';
      const level = roleHeading ? parseInt(el.getAttribute('aria-level') || '0', 10) : parseInt(el.tagName.substring(1), 10);
      if (!level || level < 1 || level > 6) continue;
      data.push({ level, text: el.textContent || '', id: el.id || '', roleHeading, selector: cssPathEval(el) });
    }
    return data;
  });

  const outline: HeadingNode[] = raw.map((h: any) => ({ level: h.level, text: h.text.trim(), ...(h.id ? { id: h.id } : {}), ...(h.roleHeading ? { roleHeading: true } : {}) }));

  const norms = { wcag: ['1.3.1', '2.4.6'], bitv: ['1.3.1', '2.4.6'] };
  const findings: HeadingsFinding[] = [];

  const h1s = raw.filter((h: any) => h.level === 1);
  const h1Count = h1s.length;
  if (h1Count === 0) {
    findings.push({ id: 'headings:missing-h1', severity: 'moderate', summary: 'Missing H1', selectors: [], pageUrl, norms });
  }
  if (h1Count > 1) {
    findings.push({ id: 'headings:multiple-h1', severity: 'minor', summary: 'Multiple H1 elements', selectors: h1s.slice(0,5).map((h:any)=>h.selector), pageUrl, norms });
  }

  let jumps = 0;
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i-1];
    const cur = raw[i];
    if (cur.level - prev.level > 1) {
      jumps++;
      findings.push({ id: 'headings:jump-level', severity: 'minor', summary: `Heading level jumps from h${prev.level} to h${cur.level}`, selectors: [prev.selector, cur.selector], pageUrl, norms });
    }
  }

  for (const h of raw) {
    if (!h.text.trim()) {
      findings.push({ id: 'headings:empty-text', severity: 'minor', summary: 'Empty heading text', selectors: [h.selector], pageUrl, norms });
    }
  }

  const stats = {
    hasH1: h1Count > 0,
    multipleH1: h1Count > 1,
    maxDepth: raw.reduce((m: number, h: any) => Math.max(m, h.level), 0),
    jumps
  };

  return { module: 'headings-outline', version: '0.1.0', outline, findings, stats };
}

const mod: Module = {
  slug: 'headings-outline',
  version: '0.1.0',
  async run(ctx) {
    const res = await scan(ctx.page, ctx.url);
    const findings: Finding[] = res.findings.map(f => ({ ...f, module: 'headings-outline', details: f.details || '' }));
    const artifact = await ctx.saveArtifact('headings_outline.json', { ...res, findings });
    return { module: 'headings-outline', version: res.version, outline: res.outline, findings, stats: res.stats, artifacts: { outline: artifact } } as any;
  }
};

export default mod;
