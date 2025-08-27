import type { Module, Severity, Finding, NormRefs } from '../../core/types.js';
import rulesMapping from '../../config/rules_mapping.json' assert { type: 'json' };
import { collectFormControls } from '../../src/a11y/forms.js';

const map: Record<string, { wcag?: string[]; bitv?: string[]; severity?: Severity }> = rulesMapping as any;

const mod: Module = {
  slug: 'forms',
  version: '0.3.0',
  async run(ctx) {
    const { fields, groups } = await ctx.page.evaluate(collectFormControls);
    for (const f of fields) (f as any).problems = [] as string[];

    const findings: Finding[] = [];
    const stats: Record<string, number> = { fields: fields.length };

    function addFinding(id: string, summary: string, details: string, selectors: string[]) {
      const m = map[id] || {};
      const norms: NormRefs = {};
      if (m.wcag) norms.wcag = m.wcag;
      if (m.bitv) norms.bitv = m.bitv;
      const severity: Severity = (m.severity || 'moderate') as Severity;
      findings.push({ id, module: 'forms', severity, summary, details, selectors, pageUrl: ctx.url, ...(Object.keys(norms).length ? { norms } : {}) });
      stats[id] = (stats[id] || 0) + 1;
    }

    for (const f of fields) {
      const probs: string[] = (f as any).problems;
      if (!f.labels.length) {
        probs.push('forms:missing-label');
        addFinding('forms:missing-label', 'Form field has no label', 'Input/select/textarea element lacks accessible name', [f.selector]);
      } else if (f.labels.length > 1) {
        probs.push('forms:multiple-labels');
        addFinding('forms:multiple-labels', 'Form field has multiple labels', 'Field is associated with multiple visible labels', [f.selector]);
      }

      if (f.validation && !f.hasErrorBinding) {
        probs.push('forms:error-not-associated');
        addFinding('forms:error-not-associated', 'Validation error not associated', 'Field has validation attributes but no associated error message via aria-describedby', [f.selector]);
      }

      if (f.required) {
        const txt = (f.labels.join(' ') || '').toLowerCase();
        const visible = txt.includes('*') || /required|erforderlich|pflichtfeld|mandatory|obligatory/.test(txt);
        if (!visible && !f.ariaRequired) {
          probs.push('forms:required-not-indicated');
          addFinding('forms:required-not-indicated', 'Required field not indicated', 'Field marked as required but not indicated in label or aria-required', [f.selector]);
        }
      }

      const labelLower = (f.labels.join(' ') + ' ' + f.name).toLowerCase();
      let expected: { type?: string; autocomplete?: string } | null = null;
      if (/e-?mail/.test(labelLower)) expected = { type: 'email', autocomplete: 'email' };
      else if (/phone|tel|telefon/.test(labelLower)) expected = { type: 'tel', autocomplete: 'tel' };
      else if (/postleitzahl|\bplz\b|postal|zip/.test(labelLower)) expected = { autocomplete: 'postal-code' };
      if (expected) {
        const typeWrong = expected.type && expected.type !== f.type;
        const ac = (f.autocomplete || '').toLowerCase();
        const acWrong = expected.autocomplete && ac !== expected.autocomplete;
        if (typeWrong || acWrong || !ac) {
          probs.push('forms:autocomplete-missing-or-wrong');
          addFinding('forms:autocomplete-missing-or-wrong', 'Autocomplete/type missing or wrong', 'Field could benefit from appropriate type or autocomplete', [f.selector]);
        }
      }
    }

    for (const name in groups) {
      const g = groups[name];
      if (g.selectors.length > 1 && !g.hasFieldsetLegend) {
        addFinding('forms:missing-fieldset-legend', 'Form controls missing fieldset/legend', 'Group of radio buttons or checkboxes lacks fieldset/legend', g.selectors.slice(0, 1));
        const target = fields.find((f: any) => f.selector === g.selectors[0]);
        if (target) (target as any).problems.push('forms:missing-fieldset-legend');
      }
    }

    const overviewPath = await ctx.saveArtifact('forms_overview.json', fields);
    return { module: 'forms', version: '0.3.0', findings, stats, artifacts: { overview: overviewPath } };
  }
};

export default mod;
