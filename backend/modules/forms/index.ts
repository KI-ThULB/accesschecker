import type { Module, Severity, Finding, NormRefs } from '../../core/types.js';
import rulesMapping from '../../config/rules_mapping.json' assert { type: 'json' };
import { collectFormControls } from '../../src/a11y/forms.js';

const map: Record<string, { wcag?: string[]; bitv?: string[]; severity?: Severity }> =
  rulesMapping as any;

  const mod: Module = {
    slug: 'forms',
    version: '0.4.0',
    async run(ctx) {
      const { fields, groups } = await ctx.page.evaluate(collectFormControls);
      for (const f of fields) (f as any).hints = (f as any).hints || [];

      const findings: Finding[] = [];
      const stats = {
        totalControls: fields.length,
        unlabeled: 0,
        errorNotBound: 0,
        requiredMissingIndicator: 0,
        groupsWithoutLegend: 0,
      };

      type StatKey = keyof typeof stats;

    function addFinding(
      id: string,
      summary: string,
      details: string,
      selectors: string[],
      statKey?: StatKey
    ) {
      const m = map[id] || {};
      const norms: NormRefs = {};
      if (m.wcag) norms.wcag = m.wcag;
      if (m.bitv) norms.bitv = m.bitv;
      const severity: Severity = (m.severity || 'moderate') as Severity;
      findings.push({
        id,
        module: 'forms',
        severity,
        summary,
        details,
        selectors,
        pageUrl: ctx.url,
        ...(Object.keys(norms).length ? { norms } : {}),
      });
      if (statKey) stats[statKey]++;
    }

    for (const f of fields) {
      const probs: string[] = (f as any).hints;
      if (!f.hasLabel) {
        probs.push('forms:label-missing');
        addFinding(
          'forms:label-missing',
          'Form control has no label',
          'Control element lacks accessible name',
          [f.selector],
          'unlabeled'
        );
      } else if (f.names && f.names.length > 1) {
        probs.push('forms:label-ambiguous');
        addFinding(
          'forms:label-ambiguous',
          'Form control has ambiguous labels',
          'Control is associated with multiple labels',
          [f.selector]
        );
      }

      if (f.validation && !f.hasErrorBinding) {
        probs.push('forms:error-not-associated');
        addFinding(
          'forms:error-not-associated',
          'Validation error not associated',
          'Field has validation attributes but no associated error message via aria-describedby',
          [f.selector],
          'errorNotBound'
        );
      }

      if (f.required) {
        const txt = (f.name || '').toLowerCase();
        const visible = txt.includes('*') || /required|erforderlich|pflichtfeld|mandatory|obligatory/.test(txt);
        if (!visible && !f.ariaRequired) {
          probs.push('forms:required-not-indicated');
          addFinding(
            'forms:required-not-indicated',
            'Required field not indicated',
            'Field marked as required but not indicated in label or aria-required',
            [f.selector],
            'requiredMissingIndicator'
          );
        }
      }

      const labelLower = (f.name + ' ' + f.attrName).toLowerCase();
      let expected: { type?: string; autocomplete?: string } | null = null;
      if (/e-?mail/.test(labelLower)) expected = { type: 'email', autocomplete: 'email' };
      else if (/phone|tel|telefon/.test(labelLower)) expected = { type: 'tel', autocomplete: 'tel' };
      else if (/postleitzahl|\bplz\b|postal|zip/.test(labelLower)) expected = { autocomplete: 'postal-code' };
      if (expected) {
        const typeWrong = expected.type && expected.type !== f.type;
        const ac = (f.autocomplete || '').toLowerCase();
        const acWrong = expected.autocomplete && ac !== expected.autocomplete;
        if (typeWrong || acWrong || !ac) {
          probs.push('forms:autocomplete-missing');
          addFinding(
            'forms:autocomplete-missing',
            'Autocomplete/type missing or wrong',
            'Field could benefit from appropriate type or autocomplete',
            [f.selector]
          );
        }
      }
    }

    for (const name in groups) {
      const g = groups[name];
      if (g.selectors.length > 1 && !g.hasFieldsetLegend) {
        addFinding(
          'forms:group-missing-legend',
          'Form controls missing fieldset/legend',
          'Group of radio buttons or checkboxes lacks fieldset/legend',
          g.selectors.slice(0, 1),
          'groupsWithoutLegend'
        );
        const target = fields.find((f: any) => f.selector === g.selectors[0]);
        if (target) (target as any).hints.push('forms:group-missing-legend');
      }
    }

    const overviewPath = await ctx.saveArtifact('forms_overview.json', fields);
    return { module: 'forms', version: '0.4.0', findings, stats, artifacts: { overview: overviewPath } };
    }
  };

export default mod;
