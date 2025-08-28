import type { Module, Finding, Severity } from '../../core/types.js';

function parseRGB(str: string): [number, number, number, number] {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/);
  if (!m) return [0, 0, 0, 1];
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] ? parseFloat(m[4]) : 1];
}

function luminance(r: number, g: number, b: number) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function contrast(c1: string, c2: string) {
  const rgb1 = parseRGB(c1);
  const rgb2 = parseRGB(c2);
  if (rgb1[3] < 1) {
    rgb1[0] = rgb1[0] * rgb1[3] + rgb2[0] * (1 - rgb1[3]);
    rgb1[1] = rgb1[1] * rgb1[3] + rgb2[1] * (1 - rgb1[3]);
    rgb1[2] = rgb1[2] * rgb1[3] + rgb2[2] * (1 - rgb1[3]);
  }
  const L1 = luminance(rgb1[0], rgb1[1], rgb1[2]);
  const L2 = luminance(rgb2[0], rgb2[1], rgb2[2]);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

const mod: Module = {
  slug: 'text-contrast',
  version: '0.1.0',
  async run(ctx) {
    const runs: any[] = await ctx.page.evaluate(() => {
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
      function getBg(el: HTMLElement): string {
        let e: HTMLElement | null = el;
        while (e) {
          const st = getComputedStyle(e);
          const bg = st.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
          e = e.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
      }
      function isHidden(el: HTMLElement): boolean {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity || '1') === 0) return true;
        if (el.getAttribute('aria-hidden') === 'true') return true;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return true;
        return false;
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = (node.textContent || '').trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          const el = node.parentElement as HTMLElement | null;
          if (!el || isHidden(el)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const res: any[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const el = node.parentElement as HTMLElement;
        const style = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const fontSize = parseFloat(style.fontSize || '0');
        const weightStr = style.fontWeight || '400';
        const weight = parseInt(weightStr, 10) || (weightStr === 'bold' ? 700 : 400);
        const isBold = weight >= 700;
        const isLarge = (!isBold && fontSize >= 18.66) || (isBold && fontSize >= 14);
        res.push({
          text: (node.textContent || '').trim().slice(0, 100),
          selector: cssPath(el),
          color: style.color,
          background: getBg(el),
          fontSizePx: fontSize,
          fontWeight: weight,
          isBold,
          isLargeText: isLarge,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
      }
      return res;
    });

    const findings: Finding[] = [];
    const ratios: number[] = [];
    let failing = 0;
    let failingLarge = 0;

    for (const r of runs) {
      const ratio = contrast(r.color, r.background);
      r.ratio = ratio;
      ratios.push(ratio);
      const expected = r.isLargeText ? 3 : 4.5;
      if (ratio < expected) {
        const id = r.isLargeText ? 'contrast:large-text-low' : 'contrast:text-low';
        const severity: Severity = r.isLargeText ? 'moderate' : 'serious';
        if (r.isLargeText) failingLarge++; else failing++;
        findings.push({
          id,
          module: 'text-contrast',
          severity,
          summary: r.isLargeText ? 'Large text contrast below 3:1' : 'Text contrast below 4.5:1',
          details: `Contrast ${ratio.toFixed(2)}:1, expected ${expected}:1`,
          selectors: [r.selector],
          pageUrl: ctx.url,
          norms: { wcag: ['1.4.3'] }
        });
      }
    }

    const stats = {
      sampled: runs.length,
      failing,
      failingLarge,
      avgRatio: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0,
      p95Ratio: ratios.length ? (() => { const s = [...ratios].sort((a, b) => a - b); return s[Math.floor(0.95 * (s.length - 1))]; })() : 0
    };

    const detailsPath = await ctx.saveArtifact('text_contrast.json', runs);

    return { module: 'text-contrast', version: '0.1.0', stats, findings, artifacts: { details: detailsPath } };
  }
};

export default mod;
