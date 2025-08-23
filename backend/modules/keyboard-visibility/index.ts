import path from 'node:path';
import { promises as fs } from 'node:fs';
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
    e = e.parentElement as HTMLElement | null;
  }
  return parts.join('>');
}

const mod: Module = {
  slug: 'keyboard-visibility',
  version: '0.1.0',
  async run(ctx) {
    const maxSteps = (ctx.config as any)?.keyboard?.maxTabs || 20;
    const findings: Finding[] = [];
    const trace: any[] = [];
    const screens: string[] = [];

    let steps = 0;
    let weakIndicators = 0;
    let contrastSum = 0;
    let areaSum = 0;

    for (let i = 0; i < maxSteps; i++) {
      await ctx.page.keyboard.press('Tab');
      await ctx.page.waitForTimeout(100);
      const info = await ctx.page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const ow = parseFloat(style.outlineWidth || '0');
        const outlineColor = style.outlineColor;
        const boxShadow = style.boxShadow || '';
        let spread = 0;
        let shadowColor = '';
        if (boxShadow && boxShadow !== 'none') {
          const parts = boxShadow.split(/\s+/);
          const nums = parts.filter(p => /px$/.test(p)).map(p => parseFloat(p));
          if (nums.length >= 4) spread = nums[3];
          const col = boxShadow.match(/rgba?\([^\)]+\)/);
          if (col) shadowColor = col[0];
        }
        const indicatorColor = ow > 0 ? outlineColor : shadowColor;
        const width = rect.width;
        const height = rect.height;
        let indicatorArea = 0;
        if (ow > 0) indicatorArea = ((width + 2 * ow) * (height + 2 * ow) - width * height);
        else if (spread > 0) indicatorArea = ((width + 2 * spread) * (height + 2 * spread) - width * height);
        const areaRatio = width * height > 0 ? indicatorArea / (width * height) : 0;
        function parseRGB(str: string): [number, number, number, number] {
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/);
          if (!m) return [0,0,0,1];
          return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] ? parseFloat(m[4]) : 1];
        }
        function luminance(r: number, g: number, b: number) {
          const a = [r,g,b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
          });
          return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
        }
        function contrast(c1: string, c2: string) {
          const rgb1 = parseRGB(c1);
          const rgb2 = parseRGB(c2);
          if (rgb1[3] < 1) {
            rgb1[0] = rgb1[0]*rgb1[3] + rgb2[0]*(1-rgb1[3]);
            rgb1[1] = rgb1[1]*rgb1[3] + rgb2[1]*(1-rgb1[3]);
            rgb1[2] = rgb1[2]*rgb1[3] + rgb2[2]*(1-rgb1[3]);
          }
          const L1 = luminance(rgb1[0],rgb1[1],rgb1[2]);
          const L2 = luminance(rgb2[0],rgb2[1],rgb2[2]);
          const lighter = Math.max(L1,L2); const darker = Math.min(L1,L2);
          return (lighter + 0.05) / (darker + 0.05);
        }
        const bg = style.backgroundColor || 'rgb(255,255,255)';
        const contrastRatio = indicatorColor ? contrast(indicatorColor, bg) : 1;
        return {
          selector: cssPath(el),
          rect: { x: rect.x, y: rect.y, width, height },
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor,
          boxShadow,
          backgroundColor: bg,
          areaRatio,
          contrastRatio,
          tabindex: el.getAttribute('tabindex') || '',
        };
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
            cur = cur.parentElement as HTMLElement | null;
          }
          return parts.join('>');
        }
      });
      if (!info) break;
      steps++;
      contrastSum += info.contrastRatio;
      areaSum += info.areaRatio;

      const margin = 16;
      const clip = {
        x: Math.max(info.rect.x - margin, 0),
        y: Math.max(info.rect.y - margin, 0),
        width: info.rect.width + margin * 2,
        height: info.rect.height + margin * 2,
      };
      const screenPath = path.join(process.cwd(), 'out', 'keyboard', 'screens', `step-${String(i+1).padStart(2,'0')}.png`);
      await fs.mkdir(path.dirname(screenPath), { recursive: true });
      try {
        const buf = await ctx.page.screenshot({ clip });
        await fs.writeFile(screenPath, buf);
        screens.push(path.relative(process.cwd(), screenPath));
      } catch {
        screens.push('');
      }

      let rule = '';
      if ((info.outlineStyle === 'none' || info.outlineWidth === '0px') && (!info.boxShadow || info.boxShadow === 'none')) {
        findings.push({
          id: 'keyboard:outline-suppressed',
          module: 'keyboard-visibility',
          severity: 'serious',
          summary: 'Outline suppressed without replacement',
          details: 'Focused element has outline:none and no visible alternative',
          selectors: [info.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.7'], bitv: ['2.4.7'] }
        });
        rule = 'keyboard:outline-suppressed';
      } else if (info.areaRatio < 0.02 || info.contrastRatio < 3) {
        findings.push({
          id: 'keyboard:focus-indicator-weak',
          module: 'keyboard-visibility',
          severity: 'serious',
          summary: 'Focus indicator weak',
          details: `Contrast ${info.contrastRatio.toFixed(2)}, area ratio ${info.areaRatio.toFixed(3)}`,
          selectors: [info.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.7'], bitv: ['2.4.7'] }
        });
        weakIndicators++;
        rule = 'keyboard:focus-indicator-weak';
      }
      trace.push({
        url: ctx.url,
        action: 'Tab',
        selector: info.selector,
        timestamp: new Date().toISOString(),
        boundingBox: info.rect,
        indicatorContrast: info.contrastRatio,
        indicatorAreaRatio: info.areaRatio,
        rule,
        screenshot: screens[screens.length-1],
      });
    }

    const domData = await ctx.page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
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
          cur = cur.parentElement as HTMLElement | null;
        }
        return parts.join('>');
      }
      return els.map(el => ({ selector: cssPath(el), tabindex: el.getAttribute('tabindex') || '' }));
    }, FOCUSABLE_SELECTOR);

    const domOrder = domData.map(d => d.selector);
    const tabIndexMap: Record<string, number> = {};
    for (const d of domData) {
      const ti = parseInt(d.tabindex || '0', 10) || 0;
      tabIndexMap[d.selector] = ti;
      if (ti > 0) {
        findings.push({
          id: 'keyboard:tabindex-gt-zero',
          module: 'keyboard-visibility',
          severity: 'moderate',
          summary: 'tabindex greater than zero',
          details: `Element ${d.selector} has tabindex ${ti}`,
          selectors: [d.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['2.4.3'], bitv: ['2.4.3'] }
        });
      }
    }
    const tabindexGtZero = Object.values(tabIndexMap).filter(v => v > 0).length;

    let tabOrderJumps = 0;
    const anomalies: {prev: string; cur: string; prevIdx: number; idx: number;}[] = [];
    let lastIdx = -1; let lastSel = '';
    for (const step of trace) {
      const sel = step.selector;
      const idx = domOrder.indexOf(sel);
      if (idx === -1) continue;
      if (idx < lastIdx) {
        tabOrderJumps++;
        anomalies.push({ prev: lastSel, cur: sel, prevIdx: lastIdx, idx });
      }
      lastIdx = idx; lastSel = sel;
    }
    if (anomalies.length) {
      const seg = anomalies.map(a => `Sprung von ${a.prev} (${a.prevIdx}) zu ${a.cur} (${a.idx})`).join('; ');
      findings.push({
        id: 'keyboard:tab-order-anomaly',
        module: 'keyboard-visibility',
        severity: 'moderate',
        summary: 'Unexpected tab order',
        details: seg,
        selectors: anomalies.slice(0,5).map(a => a.cur),
        pageUrl: ctx.url,
        norms: { wcag: ['2.4.3'], bitv: ['2.4.3'] }
      });
    }

    const traceFileAbs = await ctx.saveArtifact('keyboard_trace.json', trace);
    const traceFile = path.relative(process.cwd(), traceFileAbs);

    return {
      module: 'keyboard-visibility',
      version: '0.1.0',
      findings,
      metrics: {
        steps,
        weakIndicators,
        avgIndicatorContrast: steps ? contrastSum/steps : 0,
        avgIndicatorAreaRatio: steps ? areaSum/steps : 0,
        tabOrderJumps,
        tabindexGtZero
      },
      artifacts: { trace: traceFile, screens }
    } as any;
  }
};

export default mod;
