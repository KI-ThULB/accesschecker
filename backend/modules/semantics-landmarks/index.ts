import type { Module, Finding } from '../../core/types.js';

interface LandmarkInfo {
  selector: string;
  topLevel: boolean;
}

const mod: Module = {
  slug: 'semantics-landmarks',
  version: '0.1.0',
  async run(ctx) {
    const data = await ctx.page.evaluate(() => {
      function cssPath(el: Element): string {
        if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
        const parts: string[] = [];
        let e: Element | null = el;
        while (e && parts.length < 4) {
          let part = e.tagName.toLowerCase();
          let sibling = e.previousElementSibling;
          let count = 1;
          while (sibling) {
            if (sibling.tagName === e.tagName) count++;
            sibling = sibling.previousElementSibling as Element | null;
          }
          part += `:nth-of-type(${count})`;
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

      const res: any = {
        counts: { main: 0, banner: 0, navigation: 0, complementary: 0, contentinfo: 0, search: 0, region: 0 },
        main: [] as LandmarkInfo[],
        banner: [] as LandmarkInfo[],
        navigation: [] as LandmarkInfo[],
        complementary: [] as LandmarkInfo[],
        contentinfo: [] as LandmarkInfo[],
        search: [] as LandmarkInfo[],
        region: [] as LandmarkInfo[],
        coverage: 0,
      };

      const cand = Array.from(document.querySelectorAll('main, header, nav, aside, footer, form[role="search"], [role]'));
      const landmarks: Element[] = [];
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
        if (!(res.counts as any).hasOwnProperty(type)) {
          type = 'region';
        }
        res.counts[type] = (res.counts[type] || 0) + 1;
        const info = { selector: cssPath(el), topLevel: el.parentElement === document.body };
        (res as any)[type].push(info);
        landmarks.push(el);
      }

      const all = Array.from(document.body.querySelectorAll('*'));
      let total = 0, covered = 0;
      for (const el of all) {
        if (!isVisible(el)) continue;
        total++;
        let cur: Element | null = el;
        let ok = false;
        while (cur) {
          if (landmarks.includes(cur)) { ok = true; break; }
          cur = cur.parentElement;
        }
        if (ok) covered++;
      }
      res.coverage = total ? Math.round((covered / total) * 100) : 0;

      return res;
    });

    const findings: Finding[] = [];
    const norms = { wcag: ['1.3.1'] };

    if (data.counts.main === 0) {
      findings.push({
        id: 'landmarks:missing-main',
        module: 'semantics-landmarks',
        severity: 'moderate',
        summary: 'No main landmark present',
        details: 'Add a single <main> element around the primary content. See axe:landmark-one-main.',
        pageUrl: ctx.url,
        norms,
      });
    } else if (data.counts.main > 1) {
      findings.push({
        id: 'landmarks:duplicates-main',
        module: 'semantics-landmarks',
        severity: 'minor',
        summary: 'Multiple main landmarks',
        details: 'Use only one <main> element per page; remove role=main from other containers.',
        selectors: data.main.slice(0, 2).map((m: LandmarkInfo) => m.selector),
        pageUrl: ctx.url,
        norms,
      });
    }

    if (data.counts.banner > 1) {
      findings.push({
        id: 'landmarks:duplicates-banner',
        module: 'semantics-landmarks',
        severity: 'minor',
        summary: 'Multiple banner landmarks',
        details: 'Only one banner (header) landmark should be present.',
        selectors: data.banner.slice(0, 2).map((m: LandmarkInfo) => m.selector),
        pageUrl: ctx.url,
        norms,
      });
    }
    if (data.counts.contentinfo > 1) {
      findings.push({
        id: 'landmarks:duplicates-contentinfo',
        module: 'semantics-landmarks',
        severity: 'minor',
        summary: 'Multiple contentinfo landmarks',
        details: 'Only one contentinfo (footer) landmark should be present.',
        selectors: data.contentinfo.slice(0, 2).map((m: LandmarkInfo) => m.selector),
        pageUrl: ctx.url,
        norms,
      });
    }

    const nestedBanner = data.banner.filter((b: LandmarkInfo) => !b.topLevel).map((b: LandmarkInfo) => b.selector);
    if (nestedBanner.length) {
      findings.push({
        id: 'landmarks:nesting-banner',
        module: 'semantics-landmarks',
        severity: 'minor',
        summary: 'Banner landmark is nested',
        details: 'Banner landmarks should be top-level children of <body>.',
        selectors: nestedBanner.slice(0, 5),
        pageUrl: ctx.url,
        norms,
      });
    }
    const nestedContentinfo = data.contentinfo.filter((b: LandmarkInfo) => !b.topLevel).map((b: LandmarkInfo) => b.selector);
    if (nestedContentinfo.length) {
      findings.push({
      id: 'landmarks:nesting-contentinfo',
      module: 'semantics-landmarks',
      severity: 'minor',
      summary: 'Contentinfo landmark is nested',
      details: 'Contentinfo (footer) landmarks should be top-level children of <body>.',
      selectors: nestedContentinfo.slice(0,5),
      pageUrl: ctx.url,
      norms,
      });
    }

    if (data.coverage < 80) {
      findings.push({
        id: 'landmarks:coverage-low',
        module: 'semantics-landmarks',
        severity: 'minor',
        summary: `Landmark coverage ${data.coverage}%`,
        details: 'Ensure that most visible content is within landmark regions.',
        pageUrl: ctx.url,
        norms,
      });
    }

    return {
      module: 'semantics-landmarks',
      version: '0.1.0',
      findings,
      metrics: { coverage: data.coverage, counts: data.counts },
    } as any;
  }
};

export default mod;
