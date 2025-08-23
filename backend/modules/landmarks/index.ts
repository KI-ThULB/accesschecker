import { Module, Finding } from '../../core/types.js';

export type LandmarkFinding = {
  id: string;
  severity: 'minor' | 'moderate' | 'serious';
  summary: string;
  details?: string;
  selectors?: string[];
  metrics?: Record<string, number | string>;
};

export type RemediationHint = {
  title: string;
  snippet: string;
  appliesTo: string[];
};

function coverageBadge(cov: number) {
  if (cov >= 95) return 'green';
  if (cov >= 80) return 'yellow';
  return 'red';
}

const hints: RemediationHint[] = [
  { title: 'Hauptinhalt mit <main> kennzeichnen', snippet: '<main>…</main>', appliesTo: ['landmarks:missing-main'] },
  { title: 'Nur einen Banner verwenden', snippet: '<header role="banner">…</header>', appliesTo: ['landmarks:duplicate-banner'] },
  { title: 'Nur einen Footer verwenden', snippet: '<footer role="contentinfo">…</footer>', appliesTo: ['landmarks:duplicate-contentinfo'] },
];

const mod: Module = {
  slug: 'landmarks',
  version: '0.1.0',
  async run(ctx) {
    const data = await ctx.page.evaluate(() => {
      function cssPath(el: Element): string {
        if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
        const parts: string[] = [];
        let e: Element | null = el;
        while (e && parts.length < 4) {
          let part = e.tagName.toLowerCase();
          let sib = e.previousElementSibling;
          let cnt = 1;
          while (sib) { if (sib.tagName === e.tagName) cnt++; sib = sib.previousElementSibling; }
          part += `:nth-of-type(${cnt})`;
          parts.unshift(part);
          e = e.parentElement;
        }
        return parts.join('>');
      }
      function isVisible(el: Element): boolean {
        const style = window.getComputedStyle(el as HTMLElement);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      const cand = Array.from(document.querySelectorAll('main, header, nav, aside, footer, form[role="search"], [role]'));
      const landmarks: Element[] = [];
      const counts: Record<string, number> = { main: 0, banner: 0, contentinfo: 0 };
      for (const el of cand) {
        let type = (el.getAttribute('role') || '').toLowerCase();
        const tag = el.tagName.toLowerCase();
        if (!type) {
          if (tag === 'header') type = 'banner';
          else if (tag === 'nav') type = 'navigation';
          else if (tag === 'aside') type = 'complementary';
          else if (tag === 'footer') type = 'contentinfo';
          else if (tag === 'main') type = 'main';
        }
        if (!type) continue;
        if (!['main','banner','contentinfo','navigation','search','complementary','region'].includes(type)) type = 'region';
        if (['main','banner','contentinfo'].includes(type)) counts[type] = (counts[type] || 0) + 1;
        landmarks.push(el);
      }
      const all = Array.from(document.body.querySelectorAll('*'));
      let total = 0, covered = 0;
      const orphans: string[] = [];
      for (const el of all) {
        if (!isVisible(el)) continue;
        total++;
        let cur: Element | null = el;
        let inside = false;
        while (cur) {
          if (landmarks.includes(cur)) { inside = true; break; }
          cur = cur.parentElement;
        }
        if (inside) covered++; else if (orphans.length < 10) orphans.push(cssPath(el));
      }
      const coveragePercent = total ? Math.round((covered/total)*100) : 0;
      return { counts, coveragePercent, orphans };
    });

    const findings: Finding[] = [];
    const norms = { wcag: ['1.3.1'] };

    findings.push({
      id: 'landmarks:coverage',
      module: 'landmarks',
      severity: 'minor',
      summary: `Landmark-Abdeckung ${data.coveragePercent}%`,
      details: 'Anteil sichtbarer DOM-Knoten innerhalb von Landmarken',
      metrics: { coveragePercent: data.coveragePercent, badge: coverageBadge(data.coveragePercent) },
      pageUrl: ctx.url,
      norms,
    } as any);

    if (data.counts.main === 0) {
      findings.push({ id: 'landmarks:missing-main', module: 'landmarks', severity: 'moderate', summary: 'Fehlendes <main>-Element', details: '', pageUrl: ctx.url, norms });
    } else if ((data.counts.main || 0) > 1) {
      findings.push({ id: 'landmarks:duplicate-main', module: 'landmarks', severity: 'minor', summary: 'Mehrere <main>-Landmarks', details: '', pageUrl: ctx.url, norms });
    }
    if ((data.counts.banner || 0) > 1) {
      findings.push({ id: 'landmarks:duplicate-banner', module: 'landmarks', severity: 'minor', summary: 'Mehrere Banner-Landmarks', details: '', pageUrl: ctx.url, norms });
    }
    if ((data.counts.contentinfo || 0) > 1) {
      findings.push({ id: 'landmarks:duplicate-contentinfo', module: 'landmarks', severity: 'minor', summary: 'Mehrere Footer-Landmarks', details: '', pageUrl: ctx.url, norms });
    }
    if (data.orphans.length) {
      findings.push({ id: 'landmarks:orphans', module: 'landmarks', severity: 'minor', summary: `${data.orphans.length} Bereiche außerhalb von Landmarken`, details: '', selectors: data.orphans.slice(0,10), pageUrl: ctx.url, norms });
    }

    const artifact = await ctx.saveArtifact('landmarks.json', { stats: { coveragePercent: data.coveragePercent, counts: data.counts }, findings, snippets: hints });

    return { module: 'landmarks', version: '0.1.0', findings, metrics: { coverage: data.coveragePercent }, artifacts: { data: artifact }, hints } as any;
  }
};

export default mod;
