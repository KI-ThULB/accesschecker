import { getNameInfo } from './name.js';

export function collectFormControls() {
  const fields: any[] = [];
  const groups: Record<string, { selectors: string[]; hasFieldsetLegend: boolean; type: string }> = {};
  const all = Array.from(document.querySelectorAll('input, select, textarea')) as HTMLElement[];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    const type = (el as HTMLInputElement).type || tag;
    if (type === 'hidden' || (el as HTMLInputElement).disabled) continue;
    const { texts, sources } = getNameInfo(el as HTMLElement);
    const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
    const validation = required || el.getAttribute('aria-invalid') === 'true' || el.hasAttribute('pattern') || el.hasAttribute('min') || el.hasAttribute('max');
    const describedbyIds = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    let hasErrorBinding = false;
    for (const id of describedbyIds) {
      const d = document.getElementById(id);
      if (d && (['alert','status'].includes(d.getAttribute('role') || '') || ((d.getAttribute('aria-live') || '').toLowerCase() !== '' && (d.getAttribute('aria-live') || '').toLowerCase() !== 'off'))) {
        hasErrorBinding = true;
      }
    }
    const idSel = el.getAttribute('id') ? `#${CSS.escape(el.getAttribute('id')!)}` : '';
    const nameSel = el.getAttribute('name') ? `[name="${CSS.escape(el.getAttribute('name')!)}"]` : '';
    const selector = idSel || `${tag}${nameSel}`;
    const autocomplete = el.getAttribute('autocomplete') || '';
    fields.push({ selector, labels: texts, labelSources: sources, required, ariaRequired: el.getAttribute('aria-required') === 'true', validation, hasErrorBinding, autocomplete, type, name: el.getAttribute('name') || '' });
    if ((type === 'radio' || type === 'checkbox') && el.getAttribute('name')) {
      const g = groups[el.getAttribute('name')!] || { selectors: [], hasFieldsetLegend: false, type };
      g.selectors.push(selector);
      const fs = el.closest('fieldset');
      if (fs) {
        const lg = fs.querySelector('legend');
        if (lg && lg.textContent && lg.textContent.trim()) g.hasFieldsetLegend = true;
      }
      groups[el.getAttribute('name')!] = g;
    }
  }
  return { fields, groups };
}
