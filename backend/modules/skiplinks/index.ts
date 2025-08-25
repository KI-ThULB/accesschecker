import type { Module, Finding } from '../../core/types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type SkipLinksStats = {
  total: number;
  valid: number;
  late: number;
  targetMissing: number;
};

function cssPath(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let e: HTMLElement | null = el;
  while (e && parts.length < 4) {
    let part = e.tagName.toLowerCase();
    let sib = e.previousElementSibling as HTMLElement | null;
    let cnt = 1;
    while (sib) { if (sib.tagName === e.tagName) cnt++; sib = sib.previousElementSibling as HTMLElement | null; }
    part += `:nth-of-type(${cnt})`;
    parts.unshift(part);
    e = e.parentElement as HTMLElement | null;
  }
  return parts.join('>');
}

const mod: Module = {
  slug: 'skiplinks',
  version: '0.1.0',
  requires: ['keyboard-visibility'],
  async run(ctx) {
    const cfg =
      ctx.config.modules?.['skiplinks'] && typeof (ctx.config.modules as any)['skiplinks'] === 'object'
        ? (ctx.config.modules as any)['skiplinks']
        : {};
    const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : 3;

    let trace: any[] = [];
    try {
      const tracePath = path.join(process.cwd(), 'out', 'keyboard_trace.json');
      trace = JSON.parse(await fs.readFile(tracePath, 'utf-8'));
    } catch {}
    if (!trace.length) {
      for (let i = 0; i < 10; i++) {
        await ctx.page.keyboard.press('Tab');
        await ctx.page.waitForTimeout(20);
        const sel = await ctx.page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return '';
          function css(el: HTMLElement): string {
            if (el.id) return `#${el.id}`;
            const parts: string[] = [];
            let cur: HTMLElement | null = el;
            while (cur && parts.length < 4) {
              let part = cur.tagName.toLowerCase();
              let sib = cur.previousElementSibling as HTMLElement | null;
              let cnt = 1;
              while (sib) { if (sib.tagName === cur.tagName) cnt++; sib = sib.previousElementSibling as HTMLElement | null; }
              part += `:nth-of-type(${cnt})`;
              parts.unshift(part);
              cur = cur.parentElement as HTMLElement | null;
            }
            return parts.join('>');
          }
          return css(el);
        });
        if (!sel) break;
        trace.push({ selector: sel });
      }
    }

    const dom = await ctx.page.evaluate(() => {
      function css(el: HTMLElement): string {
        if (el.id) return `#${el.id}`;
        const parts: string[] = [];
        let cur: HTMLElement | null = el;
        while (cur && parts.length < 4) {
          let part = cur.tagName.toLowerCase();
          let sib = cur.previousElementSibling as HTMLElement | null;
          let cnt = 1;
          while (sib) { if (sib.tagName === cur.tagName) cnt++; sib = sib.previousElementSibling as HTMLElement | null; }
          part += `:nth-of-type(${cnt})`;
          parts.unshift(part);
          cur = cur.parentElement as HTMLElement | null;
        }
        return parts.join('>');
      }
      const anchors = Array.from(document.querySelectorAll('a[href^="#"]')) as HTMLAnchorElement[];
      const links = anchors.map(a => ({
        text: (a.textContent || '').replace(/\s+/g, ' ').trim() || (a.getAttribute('aria-label') || '').trim(),
        href: a.getAttribute('href') || '',
        selector: css(a),
        className: a.className || '',
        id: a.id || ''
      }));
      const targets = Array.from(new Set(Array.from(document.querySelectorAll('[id],[name]'))
        .map(el => (el.getAttribute('id') || el.getAttribute('name') || '').toLowerCase())));
      return { links, targets };
    });

    function isCandidate(l: any): boolean {
      const t = (l.text || '').toLowerCase();
      const cls = (l.className || '').toLowerCase();
      const id = (l.id || '').toLowerCase();
      return /skip|jump|bypass|sprung|zum inhalt|zum content/.test(t) || /skip|visually-hidden|sr-only/.test(cls) || /skip/.test(id);
    }

    const candidates = dom.links.filter(isCandidate);
    const stats: SkipLinksStats = { total: candidates.length, valid: 0, late: 0, targetMissing: 0 };
    const findings: Finding[] = [];
    const overview: any[] = [];
    const targetSet = new Set(dom.targets);
    const groups = new Map<string, any[]>();

    for (const l of candidates) {
      const hash = l.href.replace(/^#/, '').toLowerCase();
      const stepIndex = trace.findIndex(t => t.selector === l.selector) + 1;
      const targetExists = targetSet.has(hash);
      let focusable = false;
      let focusTransfer = false;
      if (!targetExists) {
        stats.targetMissing++;
        findings.push({
          id: 'skiplinks:target-missing',
          module: 'skiplinks',
          severity: 'serious',
          summary: 'Skip-Link-Ziel fehlt',
          details: `Ziel ${l.href} existiert nicht`,
          selectors: [l.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.1'] }
        });
      } else {
        const info = await ctx.page.evaluate(({ sel, hash }) => {
          const link = document.querySelector(sel) as HTMLAnchorElement | null;
          const t = document.getElementById(hash) || document.getElementsByName(hash)[0] as HTMLElement | null;
          if (!link || !t) return { focusable: false, focusTransfer: false };
          const focusable = t.tabIndex >= 0;
          link.click();
          const focusTransfer = document.activeElement === t;
          return { focusable, focusTransfer };
        }, { sel: l.selector, hash });
        focusable = info.focusable;
        focusTransfer = info.focusTransfer;
        if (stepIndex > threshold) {
          stats.late++;
          findings.push({
            id: 'skiplinks:late',
            module: 'skiplinks',
            severity: 'moderate',
            summary: 'Skip-Link spät im Fokusfluss',
            details: `Fokus-Schritt ${stepIndex}`,
            selectors: [l.selector],
            pageUrl: ctx.url,
            norms: { wcag: ['2.4.1'] }
          });
        } else {
          stats.valid++;
        }
        if (!focusable) {
          findings.push({
            id: 'skiplinks:target-not-focusable',
            module: 'skiplinks',
            severity: 'minor',
            summary: 'Ziel nicht fokusierbar',
            details: 'Ziel sollte tabindex="-1" erhalten',
            selectors: [l.selector],
            pageUrl: ctx.url,
            norms: { wcag: ['2.4.1'] }
          });
        }
        if (!focusTransfer) {
          findings.push({
            id: 'skiplinks:no-focus-transfer',
            module: 'skiplinks',
            severity: 'moderate',
            summary: 'Fokus springt nicht zum Ziel',
            details: 'Nach Aktivierung bleibt Fokus am Link',
            selectors: [l.selector],
            pageUrl: ctx.url,
            norms: { wcag: ['2.4.1'] }
          });
        }
      }
      overview.push({ text: l.text, href: l.href, stepIndex, selector: l.selector, targetExists });
      const arr = groups.get(hash) || [];
      arr.push(l);
      groups.set(hash, arr);
    }

    for (const [hash, arr] of groups.entries()) {
      if (arr.length > 1 && hash) {
        findings.push({
          id: 'skiplinks:redundant',
          module: 'skiplinks',
          severity: 'minor',
          summary: 'Mehrfache Skip-Links zum gleichen Ziel',
          details: `${arr.length} Skip-Links zu #${hash}`,
          selectors: arr.map(a => a.selector).slice(0,20),
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.1'] }
        });
      }
    }

    if (stats.total === 0) {
      findings.push({
        id: 'skiplinks:missing',
        module: 'skiplinks',
        severity: 'serious',
        summary: 'Kein Skip-Link vorhanden',
        details: 'Seite bietet keine Sprungmarke zum Hauptinhalt',
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.1'] }
      });
    }

    const overviewPath = await ctx.saveArtifact('skiplinks_overview.json', overview);
    return {
      module: 'skiplinks',
      version: '0.1.0',
      findings,
      stats,
      artifacts: { overview: overviewPath }
    } as any;
  }
};

export default mod;

