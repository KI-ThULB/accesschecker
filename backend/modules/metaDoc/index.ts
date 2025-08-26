import type { Module, Finding } from '../../core/types.js';

function detectLangSample(text: string): string | undefined {
  const lower = text.toLowerCase();
  const de = (lower.match(/\b(der|die|und|nicht|ist|ein|den|von|zu)\b/g) || []).length + (lower.match(/[äöüß]/g) || []).length;
  const en = (lower.match(/\b(the|and|not|is|this|that|with|from)\b/g) || []).length;
  if (de === en) return undefined;
  return de > en ? 'de' : 'en';
}

const mod: Module = {
  slug: 'metaDoc',
  version: '0.1.0',
  async run(ctx) {
    const cfg =
      ctx.config.modules?.['metaDoc'] && typeof (ctx.config.modules as any)['metaDoc'] === 'object'
        ? (ctx.config.modules as any)['metaDoc']
        : {};
    const minTitle = cfg.minTitleLength || 10;

    const raw = await ctx.page.evaluate(() => {
      const title = (document.querySelector('title')?.textContent || '').trim();
      const lang = document.documentElement.getAttribute('lang') || '';
      const xmlLang = document.documentElement.getAttribute('xml:lang') || '';
      const textSample = (document.body?.innerText || '').slice(0, 5000);
      return { title, lang, xmlLang, textSample };
    });

    const stats: any = {
      hasTitle: !!raw.title,
      titleLength: raw.title.length,
      lang: raw.lang || undefined,
      xmlLang: raw.xmlLang || undefined,
      langValid: true,
    };

    const findings: Finding[] = [];

    if (!stats.hasTitle) {
      findings.push({
        id: 'meta:title-missing',
        module: 'metaDoc',
        severity: 'serious',
        summary: 'Document is missing a <title>',
        details: '',
        selectors: [],
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.2'], bitv: ['2.4.2'] },
      });
    } else {
      if (stats.titleLength < minTitle) {
        findings.push({
          id: 'meta:title-too-short',
          module: 'metaDoc',
          severity: 'minor',
          summary: 'Document title is very short',
          details: '',
          selectors: [],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.2'], bitv: ['2.4.2'] },
        });
      }
      const delimMatch = raw.title.match(/\s[-|–|:|\|]\s/);
      if (delimMatch) {
        const parts = raw.title.split(/\s[-|–|:|\|]\s/);
        if (parts.length >= 2 && parts[0].split(' ').length <= parts[1].split(' ').length) {
          findings.push({
            id: 'meta:title-leading-site-name',
            module: 'metaDoc',
            severity: 'minor',
            summary: 'Consider putting site name at the end of the title',
            details: '',
            selectors: [],
            pageUrl: ctx.url,
          });
        }
      }
    }

    const whitelist = ['de', 'en', 'fr', 'es', 'it', 'nl', 'da', 'sv', 'fi', 'pl'];
    const bcp47 = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

    if (!stats.lang) {
      stats.langValid = false;
      findings.push({
        id: 'meta:lang-missing',
        module: 'metaDoc',
        severity: 'serious',
        summary: 'Document language is missing',
        details: '',
        selectors: ['html'],
        pageUrl: ctx.url,
        norms: { wcag: ['3.1.1'], bitv: ['3.1.1'] },
      });
    } else {
      const primary = String(stats.lang).split('-')[0].toLowerCase();
      stats.langValid = bcp47.test(stats.lang) && whitelist.includes(primary);
      if (!stats.langValid) {
        findings.push({
          id: 'meta:lang-invalid',
          module: 'metaDoc',
          severity: 'moderate',
          summary: 'Document language is invalid',
          details: `lang="${stats.lang}"`,
          selectors: ['html'],
          pageUrl: ctx.url,
          norms: { wcag: ['3.1.1'], bitv: ['3.1.1'] },
        });
      }
      if (raw.xmlLang && raw.xmlLang.toLowerCase() !== stats.lang.toLowerCase()) {
        findings.push({
          id: 'meta:lang-xml-mismatch',
          module: 'metaDoc',
          severity: 'minor',
          summary: 'lang and xml:lang mismatch',
          details: '',
          selectors: ['html'],
          pageUrl: ctx.url,
          norms: { wcag: ['3.1.1'], bitv: ['3.1.1'] },
        });
      }
      const detected = detectLangSample(raw.textSample);
      if (detected && detected !== primary) {
        findings.push({
          id: 'meta:lang-content-mismatch',
          module: 'metaDoc',
          severity: 'minor',
          summary: `Content language seems to be ${detected}`,
          details: '',
          selectors: ['html'],
          pageUrl: ctx.url,
        });
      }
    }

    return {
      module: 'metaDoc',
      version: '0.1.0',
      findings,
      stats,
    } as any;
  },
};

export default mod;
