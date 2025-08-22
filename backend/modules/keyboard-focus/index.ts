import type { ElementHandle } from 'playwright';
import { Module, Finding, Severity } from '../../core/types.js';
import { FOCUSABLE_SELECTOR, screenshotProbe } from '../../src/focus.js';

function getSelector(el: Element): string {
  if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
  const parts: string[] = [];
  let e: Element | null = el;
  while (e && parts.length < 4) {
    let part = e.tagName.toLowerCase();
    let sibling = e.previousElementSibling;
    let count = 1;
    while (sibling) {
      if (sibling.tagName === e.tagName) count++;
      sibling = sibling.previousElementSibling;
    }
    part += `:nth-of-type(${count})`;
    parts.unshift(part);
    e = e.parentElement;
  }
  return parts.join('>');
}

const mod: Module = {
  slug: 'keyboard-focus',
  version: '0.1.0',
  async run(ctx) {
    const maxTabs = (ctx.config as any)?.keyboard?.maxTabs || 50;
    const findings: Finding[] = [];
    const stats: Record<string, number> = {};
    const trace: any[] = [];

    const domData = await ctx.page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      function cssPath(el: HTMLElement) {
        if (el.id) return `#${el.id}`;
        const parts: string[] = [];
        let e: HTMLElement | null = el;
        while (e && parts.length < 4) {
          let part = e.tagName.toLowerCase();
          let sibling = e.previousElementSibling as HTMLElement | null;
          let count = 1;
          while (sibling) { if (sibling.tagName === e.tagName) count++; sibling = sibling.previousElementSibling as HTMLElement | null; }
          part += `:nth-of-type(${count})`;
          parts.unshift(part);
          e = e.parentElement;
        }
        return parts.join('>');
      }
      return els.map(el => ({ selector: cssPath(el), tabindex: el.getAttribute('tabindex') || '' }));
    }, FOCUSABLE_SELECTOR);

    const domOrder = domData.map(d => d.selector);
    const tabIndexMap: Record<string, number> = {};
    for (const d of domData) tabIndexMap[d.selector] = parseInt(d.tabindex || '0', 10) || 0;

    // skip link check
    const skipLink = await ctx.page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('a[href^="#"]')).find(a => /skip|zum\s+inhalt/i.test(a.textContent||'')) as HTMLElement | undefined;
      if (!link) return null;
      const target = link.getAttribute('href') || '';
      link.focus();
      return { selector: getSelector(link), target };
      function getSelector(el: HTMLElement) {
        if (el.id) return `#${el.id}`;
        const parts: string[] = [];
        let e: HTMLElement | null = el;
        while (e && parts.length < 4) {
          let part = e.tagName.toLowerCase();
          let sibling = e.previousElementSibling as HTMLElement | null;
          let count = 1;
          while (sibling) { if (sibling.tagName === e.tagName) count++; sibling = sibling.previousElementSibling as HTMLElement | null; }
          part += `:nth-of-type(${count})`;
          parts.unshift(part);
          e = e.parentElement;
        }
        return parts.join('>');
      }
    });
    if (skipLink) {
      await ctx.page.keyboard.press('Enter');
      await ctx.page.waitForTimeout(100);
      const focusedId = await ctx.page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || '');
      const dest = skipLink.target.replace('#', '');
      if (focusedId !== dest && !['main','content'].includes(focusedId)) {
        findings.push({
          id: 'keyboard:skiplink-broken',
          module: 'keyboard-focus',
          severity: 'minor',
          summary: 'Skip link does not move focus to main content',
          details: 'Activating skip link did not focus main content',
          selectors: [skipLink.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.1'], bitv: ['2.4.1'] }
        });
        stats['keyboard:skiplink-broken'] = (stats['keyboard:skiplink-broken'] || 0) + 1;
      }
    }

    let previousSelector = '';
    const tabOrder: string[] = [];

    for (let i = 0; i < maxTabs; i++) {
      await ctx.page.keyboard.press('Tab');
      await ctx.page.waitForTimeout(100);
      const info = await ctx.page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        function cssPath(e: HTMLElement) {
          if (e.id) return `#${e.id}`;
          const parts: string[] = [];
          let cur: HTMLElement | null = e;
          while (cur && parts.length < 4) {
            let part = cur.tagName.toLowerCase();
            let sib = cur.previousElementSibling as HTMLElement | null;
            let count = 1;
            while (sib) { if (sib.tagName === cur.tagName) count++; sib = sib.previousElementSibling as HTMLElement | null; }
            part += `:nth-of-type(${count})`;
            parts.unshift(part);
            cur = cur.parentElement;
          }
          return parts.join('>');
        }
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        const outline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
        const boxShadow = style.boxShadow && style.boxShadow !== 'none';
        return { selector: cssPath(el), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, visible, indicator: outline || boxShadow, tabindex: el.getAttribute('tabindex') || '' };
      });
      if (!info) break;
      trace.push({ url: ctx.url, action: 'Tab', selector: info.selector, timestamp: new Date().toISOString(), boundingBox: info.rect, visibleFocus: info.visible && info.indicator });
      tabOrder.push(info.selector);
      if (!(info.visible && info.indicator)) {
        findings.push({
          id: 'keyboard:focus-not-visible',
          module: 'keyboard-focus',
          severity: 'serious',
          summary: 'Focus not clearly visible',
          details: 'Focused element is not visible or lacks a focus indicator',
          selectors: [info.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.7'], bitv: ['2.4.7'] }
        });
        stats['keyboard:focus-not-visible'] = (stats['keyboard:focus-not-visible'] || 0) + 1;
        const handle = await ctx.page.$(info.selector) as ElementHandle | null;
        if (handle) await screenshotProbe(ctx.page, handle);
      }
      if (previousSelector === info.selector) {
        // try shift+tab to escape
        await ctx.page.keyboard.down('Shift');
        await ctx.page.keyboard.press('Tab');
        await ctx.page.keyboard.up('Shift');
        await ctx.page.waitForTimeout(100);
        const after = await ctx.page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null; return el ? (el.id || '') : ''; });
        if (!after || after === info.selector) {
          findings.push({
            id: 'keyboard:focus-trap',
            module: 'keyboard-focus',
            severity: 'serious',
            summary: 'Keyboard focus trapped',
            details: 'Focus did not move after Tab/Shift+Tab',
            selectors: [info.selector],
            pageUrl: ctx.url,
            norms: { wcag: ['2.1.2'], bitv: ['2.1.2'] }
          });
          stats['keyboard:focus-trap'] = (stats['keyboard:focus-trap'] || 0) + 1;
          break;
        }
      }
      previousSelector = info.selector;
    }

    // tab order anomalies
    const anomalies: string[] = [];
    let lastIdx = -1;
    for (const sel of tabOrder) {
      const idx = domOrder.indexOf(sel);
      if (idx === -1) continue;
      if (idx < lastIdx || tabIndexMap[sel] > 0) anomalies.push(sel);
      lastIdx = idx;
    }
    if (anomalies.length) {
      findings.push({
        id: 'keyboard:tab-order-anomaly',
        module: 'keyboard-focus',
        severity: 'moderate',
        summary: 'Unexpected tab order',
        details: 'Observed tab sequence deviates from DOM order or uses tabindex >0',
        selectors: anomalies.slice(0, 5),
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.3'], bitv: ['2.4.3'] }
      });
      stats['keyboard:tab-order-anomaly'] = anomalies.length;
    }

    const tracePath = await ctx.saveArtifact('keyboard_trace.json', trace);

    return {
      module: 'keyboard-focus',
      version: '0.1.0',
      findings,
      stats,
      artifacts: { trace: tracePath }
    };
  }
};

export default mod;
