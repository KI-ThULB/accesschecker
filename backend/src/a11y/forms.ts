import { getNameInfo } from './name.js';

export function collectFormControls() {
  const fields: any[] = [];
  const groups: Record<string, { selectors: string[]; hasFieldsetLegend: boolean; type: string }> = {};
  const roots: (Document | ShadowRoot)[] = [document];
  while (roots.length) {
    const root = roots.pop()!;
    const all = Array.from(
      root.querySelectorAll(
        'input, select, textarea, button, [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]'
      )
    ) as HTMLElement[];
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      const roleAttr = el.getAttribute('role') || '';
      const type = (el as HTMLInputElement).type || roleAttr || tag;
      if (type === 'hidden' || (el as HTMLInputElement).disabled) continue;
      const { texts, sources } = getNameInfo(el as HTMLElement);
      const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
      const validation =
        required ||
        el.getAttribute('aria-invalid') === 'true' ||
        el.hasAttribute('pattern') ||
        el.hasAttribute('min') ||
        el.hasAttribute('max');
      const describedbyIds = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      let hasErrorBinding = false;
      for (const id of describedbyIds) {
        const d = document.getElementById(id);
        if (
          d &&
          (['alert', 'status'].includes(d.getAttribute('role') || '') ||
            ((d.getAttribute('aria-live') || '').toLowerCase() !== '' &&
              (d.getAttribute('aria-live') || '').toLowerCase() !== 'off'))
        ) {
          hasErrorBinding = true;
        }
      }
      const idSel = el.getAttribute('id') ? `#${CSS.escape(el.getAttribute('id')!)}` : '';
      const nameSel = el.getAttribute('name') ? `[name="${CSS.escape(el.getAttribute('name')!)}"]` : '';
      const selector = idSel || `${tag}${nameSel}`;
      const autocomplete = el.getAttribute('autocomplete') || '';
      const group = (type === 'radio' || type === 'checkbox') && el.getAttribute('name') ? el.getAttribute('name')! : '';
      const entry: any = {
        selector,
        type,
        name: texts.join(' '),
        names: texts,
        hasLabel: texts.length > 0,
        labelSources: sources,
        attrName: el.getAttribute('name') || '',
        required,
        ariaRequired: el.getAttribute('aria-required') === 'true',
        validation,
        hasErrorBinding,
        autocomplete,
        group,
        hints: [] as string[],
      };
      fields.push(entry);
      if (group) {
        const g = groups[group] || { selectors: [], hasFieldsetLegend: false, type };
        g.selectors.push(selector);
        const fs = el.closest('fieldset');
        if (fs) {
          const lg = fs.querySelector('legend');
          if (lg && lg.textContent && lg.textContent.trim()) g.hasFieldsetLegend = true;
        }
        groups[group] = g;
      }
    }
    (root.querySelectorAll('*') as NodeListOf<HTMLElement>).forEach((e) => {
      const sr = (e as any).shadowRoot as ShadowRoot | undefined;
      if (sr) roots.push(sr);
    });
  }
  return { fields, groups };
}
