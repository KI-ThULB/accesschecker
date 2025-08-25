import type { Module, Finding } from '../../core/types.js';

function normalize(s: string | null): string {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const mod: Module = {
  slug: 'images',
  version: '0.1.0',
  async run(ctx) {
    const raw: any[] = await ctx.page.evaluate(() => {
      function __name(e: any, _?: any) { return e; }
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
      const results: any[] = [];
      for (const el of Array.from(document.querySelectorAll('img'))) {
        if (!isVisible(el)) continue;
        const link = el.closest('a,button');
        results.push({
          type: 'img',
          alt: el.getAttribute('alt'),
          src: el.getAttribute('src') || '',
          role: el.getAttribute('role') || '',
          ariaHidden: el.getAttribute('aria-hidden') === 'true',
          selector: cssPath(el),
          filename: (el.getAttribute('src') || '').split('/').pop() || '',
          parentText: link ? (link.textContent || '').trim() : '',
          naturalWidth: (el as HTMLImageElement).naturalWidth,
          naturalHeight: (el as HTMLImageElement).naturalHeight,
        });
      }
      for (const el of Array.from(document.querySelectorAll('svg'))) {
        if (!isVisible(el)) continue;
        const link = el.closest('a,button');
        const labelledby = el.getAttribute('aria-labelledby');
        let labelledbyText = '';
        if (labelledby) {
          for (const id of labelledby.split(/\s+/)) {
            const ref = document.getElementById(id);
            if (ref) labelledbyText += ' ' + (ref.textContent || '').trim();
          }
          labelledbyText = labelledbyText.trim();
        }
        results.push({
          type: 'svg',
          hasTitle: !!el.querySelector('title'),
          hasDesc: !!el.querySelector('desc'),
          ariaLabel: el.getAttribute('aria-label') || '',
          labelledbyText,
          role: el.getAttribute('role') || '',
          ariaHidden: el.getAttribute('aria-hidden') === 'true',
          selector: cssPath(el),
          inLink: !!link,
        });
      }
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const style = window.getComputedStyle(el as HTMLElement);
        if (!isVisible(el) || !style.backgroundImage || style.backgroundImage === 'none') continue;
        const m = style.backgroundImage.match(/url\((['\"]?)([^'\"]+)\1\)/);
        if (m) {
          results.push({ type: 'css', src: m[2], selector: cssPath(el) });
        }
      }
      for (const el of Array.from(document.querySelectorAll('input[type="image"]'))) {
        if (!isVisible(el)) continue;
        results.push({
          type: 'input-image',
          alt: el.getAttribute('alt') || '',
          src: el.getAttribute('src') || '',
          selector: cssPath(el),
        });
      }
      for (const el of Array.from(document.querySelectorAll('area'))) {
        results.push({
          type: 'area',
          alt: el.getAttribute('alt') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          selector: cssPath(el),
        });
      }
      return results;
    });

    const stats = { total: 0, withAlt: 0, missingAlt: 0, decorativeCount: 0, svgCount: 0 };
    const findings: Finding[] = [];

    const missingAltSelectors: string[] = [];
    const redundantSelectors: string[] = [];
    const decorativeSelectors: string[] = [];
    const filenameSelectors: string[] = [];
    const imageOfTextSelectors: string[] = [];
    const svgMissingTitleSel: string[] = [];
    const inputImageMissingSel: string[] = [];
    const areaMissingAltSel: string[] = [];

    for (const r of raw) {
      if (r.type === 'img') {
        stats.total++;
        const alt = r.alt || '';
        const hasAlt = alt.trim().length > 0;
        if (hasAlt) stats.withAlt++; else stats.missingAlt++;
        const isDecorative = ['presentation', 'none'].includes((r.role || '').toLowerCase()) || r.ariaHidden;
        if (isDecorative) stats.decorativeCount++;
        if (!hasAlt && !isDecorative) {
          if (missingAltSelectors.length < 20) missingAltSelectors.push(r.selector);
        } else if (isDecorative && hasAlt) {
          if (decorativeSelectors.length < 20) decorativeSelectors.push(r.selector);
        }
        const parentTextNorm = normalize(r.parentText);
        const altNorm = normalize(alt);
        if (alt && parentTextNorm && altNorm === parentTextNorm) {
          if (redundantSelectors.length < 20) redundantSelectors.push(r.selector);
        }
        const fname = normalize((r.filename || '').replace(/\.[a-z0-9]+$/, ''));
        if (alt && fname && altNorm === fname) {
          if (filenameSelectors.length < 20) filenameSelectors.push(r.selector);
        }
        if (r.naturalHeight && r.naturalWidth) {
          const ratio = r.naturalWidth / r.naturalHeight;
          if (r.naturalHeight < 50 && ratio > 3) {
            if (imageOfTextSelectors.length < 20) imageOfTextSelectors.push(r.selector);
          }
        }
      } else if (r.type === 'svg') {
        stats.svgCount++;
        const hasLabel = r.hasTitle || r.hasDesc || r.ariaLabel || r.labelledbyText;
        const isDecorative = ['presentation', 'none'].includes((r.role || '').toLowerCase()) || r.ariaHidden;
        if (!hasLabel && !isDecorative && (r.inLink || (r.role && r.role !== 'presentation'))) {
          if (svgMissingTitleSel.length < 20) svgMissingTitleSel.push(r.selector);
        }
      } else if (r.type === 'input-image') {
        const alt = r.alt.trim();
        if (!alt) {
          if (inputImageMissingSel.length < 20) inputImageMissingSel.push(r.selector);
        }
      } else if (r.type === 'area') {
        const alt = (r.alt || '').trim();
        const ariaLabel = (r.ariaLabel || '').trim();
        if (!alt && !ariaLabel) {
          if (areaMissingAltSel.length < 20) areaMissingAltSel.push(r.selector);
        }
      }
    }

    if (missingAltSelectors.length) {
      findings.push({
        id: 'images:missing-alt',
        module: 'images',
        severity: 'serious',
        summary: 'Image without alt text',
        details: '',
        selectors: missingAltSelectors,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }
    if (redundantSelectors.length) {
      findings.push({
        id: 'images:redundant-alt',
        module: 'images',
        severity: 'minor',
        summary: 'Alt text duplicates nearby text',
        details: '',
        selectors: redundantSelectors,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }
    if (decorativeSelectors.length) {
      findings.push({
        id: 'images:decorative-with-alt',
        module: 'images',
        severity: 'minor',
        summary: 'Decorative image with alt text',
        details: '',
        selectors: decorativeSelectors,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }
    if (filenameSelectors.length) {
      findings.push({
        id: 'images:filename-as-alt',
        module: 'images',
        severity: 'minor',
        summary: 'Alt text equals filename',
        details: '',
        selectors: filenameSelectors,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }
    if (imageOfTextSelectors.length) {
      findings.push({
        id: 'images:image-of-text',
        module: 'images',
        severity: 'moderate',
        summary: 'Image likely contains text',
        details: '',
        selectors: imageOfTextSelectors,
        pageUrl: ctx.url,
        norms: { wcag: ['1.4.5'], bitv: ['1.4.5'] },
      });
    }
    if (svgMissingTitleSel.length) {
      findings.push({
        id: 'images:svg-missing-title',
        module: 'images',
        severity: 'minor',
        summary: 'SVG without title/desc',
        details: '',
        selectors: svgMissingTitleSel,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }
    if (inputImageMissingSel.length) {
      findings.push({
        id: 'images:input-image-missing-alt',
        module: 'images',
        severity: 'serious',
        summary: 'Input image without alt',
        details: '',
        selectors: inputImageMissingSel,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }
    if (areaMissingAltSel.length) {
      findings.push({
        id: 'images:imagemap-area-missing-alt',
        module: 'images',
        severity: 'serious',
        summary: 'Image map area without alt',
        details: '',
        selectors: areaMissingAltSel,
        pageUrl: ctx.url,
        norms: { wcag: ['1.1.1'], bitv: ['1.1.1'] },
      });
    }

    const indexPath = await ctx.saveArtifact('images_index.json', raw);

    return {
      module: 'images',
      version: '0.1.0',
      findings,
      stats,
      artifacts: { index: indexPath },
    } as any;
  },
};

export default mod;
