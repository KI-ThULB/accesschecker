import type { Module, Finding } from '../../core/types.js';

const mod: Module = {
  slug: 'meta-doc',
  version: '0.1.0',
  async run(ctx) {
    const cfg =
      ctx.config.modules?.['meta-doc'] && typeof (ctx.config.modules as any)['meta-doc'] === 'object'
        ? (ctx.config.modules as any)['meta-doc']
        : {};
    const minTitle = cfg.minTitleLength ?? 10;
    const enableHeuristics = cfg.enableContentHeuristics ?? false;

    const raw = await ctx.page.evaluate(() => {
      const title = (document.querySelector('title')?.textContent || '').trim();
      const lang = (document.documentElement.getAttribute('lang') || '').trim().toLowerCase();
      const xmlLang = (document.documentElement.getAttribute('xml:lang') || '').trim().toLowerCase();
      const metaCharset = document.querySelector('meta[charset]')?.getAttribute('charset') || '';
      const navLang = (navigator.language || '').trim().toLowerCase();
      const langCounts: Record<string, number> = {};
      for (const el of Array.from(document.querySelectorAll('[lang]'))) {
        const l = (el.getAttribute('lang') || '').trim().toLowerCase();
        if (!l) continue;
        langCounts[l] = (langCounts[l] || 0) + 1;
      }
      const domLang = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      return { title, lang, xmlLang, metaCharset, navLang, domLang };
    });

    const stats: any = {
      hasTitle: !!raw.title,
      titleLength: raw.title.length,
      lang: raw.lang || undefined,
      xmlLang: raw.xmlLang || undefined,
      langValid: true,
      metaCharset: raw.metaCharset || undefined,
    };

    const findings: Finding[] = [];

    if (!stats.hasTitle) {
      findings.push({
        id: 'meta:title-missing',
        module: 'meta-doc',
        severity: 'serious',
        summary: 'Document is missing a <title>',
        details: '',
        selectors: [],
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.2'], bitv: ['2.4.2'] },
      });
    } else if (stats.titleLength < minTitle) {
      findings.push({
        id: 'meta:title-too-short',
        module: 'meta-doc',
        severity: 'minor',
        summary: 'Document title is very short',
        details: '',
        selectors: [],
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.2'], bitv: ['2.4.2'] },
      });
    }

    const bcp47 = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

    if (!stats.lang) {
      stats.langValid = false;
      findings.push({
        id: 'meta:lang-missing',
        module: 'meta-doc',
        severity: 'serious',
        summary: 'Document language is missing',
        details: '',
        selectors: ['html'],
        pageUrl: ctx.url,
        norms: { wcag: ['3.1.1'], bitv: ['3.1.1'] },
      });
    } else {
      stats.langValid = bcp47.test(stats.lang);
      if (!stats.langValid) {
        findings.push({
          id: 'meta:lang-invalid',
          module: 'meta-doc',
          severity: 'moderate',
          summary: 'Document language is invalid',
          details: `lang="${stats.lang}"`,
          selectors: ['html'],
          pageUrl: ctx.url,
          norms: { wcag: ['3.1.1'], bitv: ['3.1.1'] },
        });
      }
      if (stats.xmlLang && stats.xmlLang.split('-')[0] !== stats.lang.split('-')[0]) {
        findings.push({
          id: 'meta:lang-xml-mismatch',
          module: 'meta-doc',
          severity: 'minor',
          summary: 'lang and xml:lang mismatch',
          details: '',
          selectors: ['html'],
          pageUrl: ctx.url,
          norms: { wcag: ['3.1.1'], bitv: ['3.1.1'] },
        });
      }
      if (enableHeuristics) {
        const guess = (raw.navLang || raw.domLang || '').split('-')[0];
        const primary = stats.lang.split('-')[0];
        if (guess && primary && guess !== primary) {
          findings.push({
            id: 'meta:lang-content-mismatch',
            module: 'meta-doc',
            severity: 'advice',
            summary: `Content language seems to be ${guess}`,
            details: '',
            selectors: ['html'],
            pageUrl: ctx.url,
          });
        }
      }
    }

    return {
      module: 'meta-doc',
      version: '0.1.0',
      stats,
      findings,
      artifacts: {},
    } as any;
  },
};

export default mod;
