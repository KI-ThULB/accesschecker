import type { Module, Finding } from '../../core/types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LinksStats = {
  total: number;
  nondescriptive: number;
  rawUrl: number;
  dupTextGroups: number;
  dupTargetGroups: number;
  shareWeak: number;
};

const hints = [
  {
    title: 'Sprechende Linktexte formulieren',
    snippet:
      '<a href="/produkte">Produkte im Überblick</a> <!-- statt <a href="/produkte">hier</a> -->',
    appliesTo: [
      'links:nondescriptive',
      'links:raw-url',
      'links:text-dup-different-target',
      'links:target-dup-different-text',
    ],
  },
  {
    title: 'Icon-Link beschreiben',
    snippet: '<a href="/suche" aria-label="Suche"><svg>…</svg></a>',
    appliesTo: ['links:icon-only'],
  },
];

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(/\s+/));
  const sb = new Set(b.split(/\s+/));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union ? inter / union : 1;
}

function normalizeText(s: string): string {
  return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeHref(h: string, base: string, compareQuery: boolean): string {
  try {
    const u = new URL(h, base);
    if (!compareQuery) u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return h;
  }
}

const mod: Module = {
  slug: 'links',
  version: '0.1.0',
  async run(ctx) {
    const cfg =
      ctx.config.modules?.['links'] && typeof (ctx.config.modules as any)['links'] === 'object'
        ? (ctx.config.modules as any)['links']
        : {};
    const compareQuery = cfg.compareQuery ? true : false;
    let weakTexts: string[] = [
      'hier',
      'mehr',
      'weiter',
      'click here',
      'more',
      'learn more',
      'weiterlesen',
      'details',
      'link',
    ];
    if (cfg.weakTexts) {
      try {
        const p = path.isAbsolute(cfg.weakTexts)
          ? cfg.weakTexts
          : path.join(process.cwd(), cfg.weakTexts);
        weakTexts = JSON.parse(await fs.readFile(p, 'utf-8'));
      } catch {}
    }

    const raw = await ctx.page.evaluate(() => {
      function cssPath(el: Element): string {
        if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
        const parts: string[] = [];
        let e: Element | null = el;
        while (e && parts.length < 4) {
          let part = e.tagName.toLowerCase();
          let sib = e.previousElementSibling;
          let cnt = 1;
          while (sib) {
            if (sib.tagName === e.tagName) cnt++;
            sib = sib.previousElementSibling;
          }
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
      return Array.from(document.querySelectorAll('a[href]'))
        .map((el) => {
          if (!isVisible(el)) return null;
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const ariaLabel = (el.getAttribute('aria-label') || '').trim();
          let labelledbyText = '';
          const labelledby = el.getAttribute('aria-labelledby');
          if (labelledby) {
            for (const id of labelledby.split(/\s+/)) {
              const ref = document.getElementById(id);
              if (ref) labelledbyText += ' ' + (ref.textContent || '').trim();
            }
            labelledbyText = labelledbyText.trim();
          }
          const title = (el.getAttribute('title') || '').trim();
          let acc = text || ariaLabel || labelledbyText || title;
          const iconOnly = !text && !ariaLabel && !labelledbyText && !title;
          return { text: acc, href: el.getAttribute('href') || '', selector: cssPath(el), iconOnly };
        })
        .filter(Boolean);
    });

    const links = raw.map((l: any) => ({
      textNorm: normalizeText(l.text),
      hrefNorm: normalizeHref(l.href, ctx.url, compareQuery),
      selector: l.selector,
      iconOnly: l.iconOnly,
      text: l.text,
      href: l.href,
    }));

    const stats: LinksStats = {
      total: links.length,
      nondescriptive: 0,
      rawUrl: 0,
      dupTextGroups: 0,
      dupTargetGroups: 0,
      shareWeak: 0,
    };
    const findings: Finding[] = [];

    const weakSelectors: string[] = [];
    const rawSelectors: string[] = [];
    const iconSelectors: string[] = [];

    const weakSet = new Set(weakTexts.map((s) => s.toLowerCase()));
    for (const l of links) {
      if (l.iconOnly) iconSelectors.push(l.selector);
      const textLower = l.textNorm;
      if (weakSet.has(textLower)) {
        stats.nondescriptive++;
        if (weakSelectors.length < 20) weakSelectors.push(l.selector);
      }
      if (/^https?:\/\//.test(textLower) || /^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/.test(textLower)) {
        stats.rawUrl++;
        if (rawSelectors.length < 20) rawSelectors.push(l.selector);
      }
    }
    stats.shareWeak = stats.total ? Math.round((stats.nondescriptive / stats.total) * 1000) / 10 : 0;

    if (stats.nondescriptive) {
      findings.push({
        id: 'links:nondescriptive',
        module: 'links',
        severity: 'minor',
        summary: 'Nondescriptive link text',
        details: '',
        selectors: weakSelectors,
        pageUrl: ctx.url,
        metrics: { shareWeak: stats.shareWeak, weakCount: stats.nondescriptive },
        norms: { wcag: ['2.4.4'], bitv: ['2.4.4'] },
      });
    }
    if (stats.rawUrl) {
      findings.push({
        id: 'links:raw-url',
        module: 'links',
        severity: 'minor',
        summary: 'Link text is a raw URL',
        details: '',
        selectors: rawSelectors,
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.4'], bitv: ['2.4.4'] },
      });
    }
    if (iconSelectors.length) {
      findings.push({
        id: 'links:icon-only',
        module: 'links',
        severity: 'minor',
        summary: 'Icon-only link without text',
        details: '',
        selectors: iconSelectors.slice(0, 20),
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.4'], bitv: ['2.4.4'] },
      });
    }

    const textGroups = new Map<string, any[]>();
    for (const l of links) {
      if (!l.textNorm) continue;
      const arr = textGroups.get(l.textNorm) || [];
      arr.push(l);
      textGroups.set(l.textNorm, arr);
    }
    for (const [txt, arr] of textGroups.entries()) {
      const dests = new Set(arr.map((a) => a.hrefNorm));
      if (dests.size > 1) {
        stats.dupTextGroups++;
        findings.push({
          id: 'links:text-dup-different-target',
          module: 'links',
          severity: 'minor',
          summary: `Same link text "${txt}" points to different targets`,
          details: '',
          selectors: arr.slice(0, 20).map((a) => a.selector),
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.4'], bitv: ['2.4.4'] },
        });
      }
    }

    const targetGroups = new Map<string, any[]>();
    for (const l of links) {
      const arr = targetGroups.get(l.hrefNorm) || [];
      arr.push(l);
      targetGroups.set(l.hrefNorm, arr);
    }
    for (const [href, arr] of targetGroups.entries()) {
      const texts = arr.map((a) => a.textNorm).filter((t) => t);
      if (texts.length < 2) continue;
      let different = false;
      for (let i = 0; i < texts.length && !different; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          if (jaccard(texts[i], texts[j]) < 0.3) {
            different = true;
            break;
          }
        }
      }
      if (different) {
        stats.dupTargetGroups++;
        findings.push({
          id: 'links:target-dup-different-text',
          module: 'links',
          severity: 'minor',
          summary: 'Same target with differing link texts',
          details: '',
          selectors: arr.slice(0, 20).map((a) => a.selector),
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.4'], bitv: ['2.4.4'] },
        });
      }
    }

    const overviewPath = await ctx.saveArtifact('links_overview.json', links);
    return {
      module: 'links',
      version: '0.1.0',
      findings,
      stats,
      artifacts: { overview: overviewPath },
      hints,
    } as any;
  },
};

export default mod;
