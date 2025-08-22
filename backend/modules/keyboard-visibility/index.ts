import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Module, Finding } from '../../core/types.js';
import { FOCUSABLE_SELECTOR } from '../../src/focus.js';

function cssPath(el: HTMLElement): string {
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

const mod: Module = {
  slug: 'keyboard-visibility',
  version: '0.1.0',
  async run(ctx) {
    const maxTabs = (ctx.config as any)?.keyboard?.maxTabs || 20;
    const findings: Finding[] = [];
    const metrics = {
      steps: 0,
      weakIndicators: 0,
      avgIndicatorContrast: 0,
      avgIndicatorAreaRatio: 0,
      tabOrderJumps: 0,
      tabindexGtZero: 0
    };
    const screens: string[] = [];
    const trace: any[] = [];

    const domData = await ctx.page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      return els.map(el => ({ selector: cssPath(el), tabindex: el.getAttribute('tabindex') || '' }));
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
    }, FOCUSABLE_SELECTOR);

    const domOrder = domData.map(d => d.selector);
    const tabIndexMap: Record<string, number> = {};
    for (const d of domData) {
      const val = parseInt(d.tabindex || '0', 10) || 0;
      tabIndexMap[d.selector] = val;
      if (val > 0) {
        metrics.tabindexGtZero++;
        findings.push({
          id: 'keyboard:tabindex-gt-zero',
          module: 'keyboard-visibility',
          severity: 'moderate',
          summary: 'Element uses tabindex > 0',
          details: `tabindex ${val}`,
          selectors: [d.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.3'], bitv: ['2.4.3'] }
        });
      }
    }

    const outDir = path.join(process.cwd(), 'out', 'keyboard');
    await fs.mkdir(outDir, { recursive: true });

    const tabOrder: string[] = [];

    for (let i = 0; i < maxTabs; i++) {
      await ctx.page.keyboard.press('Tab');
      await ctx.page.waitForTimeout(100);
      const info = await ctx.page.evaluate(() => {
        const __name = () => {};
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const outlineWidth = parseFloat(style.outlineWidth || '0');
        const outlineStyle = style.outlineStyle;
        const outlineColor = style.outlineColor;
        const boxShadow = style.boxShadow || '';
        const bg = style.backgroundColor;
        const m = boxShadow.match(/rgba?\([^\)]+\)/);
        const shadowColor = m ? m[0] : '';
        const spreadMatch = boxShadow.match(/(-?\d+px)(?!.*-?\d+px)/);
        const spread = spreadMatch ? parseFloat(spreadMatch[0]) : 0;
        const hasOutline = outlineStyle !== 'none' && outlineWidth > 0;
        const hasShadow = !!shadowColor;
        const indicatorColor = hasOutline ? outlineColor : shadowColor;
        const indicatorWidth = hasOutline ? outlineWidth : spread;
        const elArea = rect.width * rect.height;
        const indicatorArea = indicatorWidth > 0 ? ((rect.width + 2*indicatorWidth) * (rect.height + 2*indicatorWidth) - elArea) : 0;
        const indicatorAreaRatio = elArea > 0 ? indicatorArea / elArea : 0;
        const parseColor = (c:string) => { const ctx2 = document.createElement('canvas').getContext('2d')!; ctx2.fillStyle = c; const hex = ctx2.fillStyle as string; const bigint = parseInt(hex.slice(1),16); return [ (bigint>>16)&255, (bigint>>8)&255, bigint&255 ]; };
        const luminance = (r:number,g:number,b:number) => { const a=[r,g,b].map(v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; };
        const contrastRatio = (c1:string,c2:string) => { if(!c1||!c2) return 0; const [r1,g1,b1]=parseColor(c1); const [r2,g2,b2]=parseColor(c2); const L1=luminance(r1,g1,b1); const L2=luminance(r2,g2,b2); const Lmax=Math.max(L1,L2); const Lmin=Math.min(L1,L2); return (Lmax+0.05)/(Lmin+0.05); };
        const contrast = indicatorColor ? contrastRatio(indicatorColor, bg) : 0;
        const clip = { x: Math.max(0, rect.x-16), y: Math.max(0, rect.y-16), width: Math.min(window.innerWidth - Math.max(0, rect.x-16), rect.width+32), height: Math.min(window.innerHeight - Math.max(0, rect.y-16), rect.height+32) };
        const selector = (() => {
          const e = el;
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
        })();
        return { selector, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, indicatorAreaRatio, contrast, hasIndicator: hasOutline || hasShadow, clip };
      });
      if (!info) break;
      metrics.steps++;
      metrics.avgIndicatorContrast += info.contrast;
      metrics.avgIndicatorAreaRatio += info.indicatorAreaRatio;
      const screenFile = path.join(outDir, `s${metrics.steps}.png`);
      try {
        await ctx.page.screenshot({ path: screenFile, clip: info.clip, timeout: 1000 });
        screens.push(screenFile);
      } catch {}
      trace.push({ url: ctx.url, action: 'Tab', selector: info.selector, timestamp: new Date().toISOString(), boundingBox: info.rect });
      tabOrder.push(info.selector);
      if (!info.hasIndicator) {
        findings.push({
          id: 'keyboard:outline-suppressed',
          module: 'keyboard-visibility',
          severity: 'serious',
          summary: 'Focus indicator suppressed',
          details: `Screenshot: ${screenFile}`,
          selectors: [info.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.7'], bitv: ['2.4.7'] },
          ...( { extra: { contrast: info.contrast, areaRatio: info.indicatorAreaRatio, screenshot: screenFile } } as any )
        });
      } else if (info.indicatorAreaRatio < 0.02 || info.contrast < 3) {
        metrics.weakIndicators++;
        findings.push({
          id: 'keyboard:focus-indicator-weak',
          module: 'keyboard-visibility',
          severity: 'serious',
          summary: 'Focus indicator weak',
          details: `contrast ${info.contrast.toFixed(2)}, ratio ${info.indicatorAreaRatio.toFixed(3)}; Screenshot: ${screenFile}`,
          selectors: [info.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.7'], bitv: ['2.4.7'] },
          ...( { extra: { contrast: info.contrast, areaRatio: info.indicatorAreaRatio, screenshot: screenFile } } as any )
        });
      }
      previousSelector = info.selector;
    }

    if (metrics.steps > 0) {
      metrics.avgIndicatorContrast = metrics.avgIndicatorContrast / metrics.steps;
      metrics.avgIndicatorAreaRatio = metrics.avgIndicatorAreaRatio / metrics.steps;
    }

    // tab order anomalies
    const segments: { from: string; to: string; fromIndex: number; toIndex: number }[] = [];
    let lastIdx = -1;
    let lastSel = '';
    for (const sel of tabOrder) {
      const idx = domOrder.indexOf(sel);
      if (idx === -1) continue;
      if (idx < lastIdx) {
        segments.push({ from: lastSel, to: sel, fromIndex: lastIdx, toIndex: idx });
      }
      lastIdx = idx;
      lastSel = sel;
    }
    metrics.tabOrderJumps = segments.length;
    if (segments.length) {
      const detail = segments.map(s => `Sprung von ${s.from} (${s.fromIndex}) zu ${s.to} (${s.toIndex})`).join('; ');
      findings.push({
        id: 'keyboard:tab-order-anomaly',
        module: 'keyboard-visibility',
        severity: 'moderate',
        summary: 'Unexpected tab order',
        details: detail,
        selectors: segments.map(s => s.to).slice(0, 5),
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.3'], bitv: ['2.4.3'] }
      });
    }

    const tracePath = await ctx.saveArtifact('keyboard_trace.json', trace);

    return {
      module: 'keyboard-visibility',
      version: '0.1.0',
      findings,
      stats: { weakIndicators: metrics.weakIndicators, tabOrderJumps: metrics.tabOrderJumps },
      metrics,
      artifacts: { trace: tracePath, screens: screens }
    };
  }
};

export default mod;
