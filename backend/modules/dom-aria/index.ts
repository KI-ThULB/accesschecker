import axe from 'axe-core';
import { Module, Severity, Finding, NormRefs } from '../../core/types.js';
import rulesMapping from '../../config/rules_mapping.json' assert { type: 'json' };

const map: Record<string, { wcag?: string[]; bitv?: string[]; severity?: Severity }> = rulesMapping as any;

const mod: Module = {
  slug: 'dom-aria',
  version: '0.2.0',
  async run(ctx) {
    await ctx.page.addScriptTag({ content: axe.source });
    const axeRes = await ctx.page.evaluate(async () => {
      return await (window as any).axe.run(document);
    });

    const findings: Finding[] = [];
    const stats: Record<string, number> = {};

    for (const violation of axeRes.violations || []) {
      const ruleId: string = violation.id;
      const m = map[ruleId] || {};
      for (const node of violation.nodes || []) {
        const selectors = (node.target || []).slice(0, 5).map(String);
        const norms: NormRefs = {};
        if (m.wcag) norms.wcag = m.wcag;
        if (m.bitv) norms.bitv = m.bitv;
        const severity: Severity = (m.severity || violation.impact || 'serious') as Severity;
        findings.push({
          id: `axe:${ruleId}`,
          module: 'dom-aria',
          severity,
          summary: violation.help,
          details: violation.description,
          selectors,
          pageUrl: ctx.url,
          ...(Object.keys(norms).length ? { norms } : {})
        });
        stats[ruleId] = (stats[ruleId] || 0) + 1;
      }
    }

    const axePath = await ctx.saveArtifact('axe_raw.json', axeRes);
    await ctx.saveArtifact('issues.json', findings);

    return {
      module: 'dom-aria',
      version: '0.2.0',
      findings,
      stats,
      artifacts: { axe: axePath }
    };
  }
};

export default mod;
