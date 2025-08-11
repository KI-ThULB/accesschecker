import { program } from 'commander';
import { chromium } from 'playwright';
import nunjucks from 'nunjucks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';

type AxeViolation = {
  id: string;
  impact?: string;
  help: string;
  tags: string[];
  nodes: { target: string[]; failureSummary: string }[];
};

program
  .requiredOption('--url <url>', 'Start URL to scan')
  .option('--out <dir>', 'Output directory', 'out');

program.parse(process.argv);
const { url, out } = program.opts<{ url: string; out: string }>();

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function computeScore(violations: AxeViolation[]) {
  // Very simple heuristic: start at 100, subtract weighted penalties
  let score = 100;
  const weights: Record<string, number> = {
    critical: 5,
    serious: 3,
    moderate: 2,
    minor: 1
  };
  for (const v of violations) {
    const w = weights[v.impact || 'moderate'] || 2;
    score -= Math.min(20, w * Math.min(5, v.nodes.length));
  }
  return Math.max(0, Math.min(100, score));
}

async function main() {
  await ensureDir(out);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle' });
  // Basic interaction: scroll to trigger lazy content
  await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); });
  await page.waitForTimeout(600);

  const axe = new AxeBuilder({ page });
  const results = await axe.analyze();
  const violations: AxeViolation[] = (results.violations || []) as any[];
  const incomplete: any[] = (results.incomplete || []) as any[];

  const score = computeScore(violations);
  const date = new Date().toISOString();

  const summary = {
    url, date, score,
    totals: { violations: violations.length, incomplete: incomplete.length },
    violations
  };

  await fs.writeFile(path.join(out, 'scan.json'), JSON.stringify(summary, null, 2), 'utf-8');

  // Render HTML reports
  nunjucks.configure(path.join(process.cwd(), 'reports', 'templates'), { autoescape: true });
  const recommendations = [
    'Erhöhen Sie Kontraste auf mindestens 4.5:1 für normalen Text.',
    'Beschriften Sie Formularelemente eindeutig (label + name/role).',
    'Stellen Sie Fokus-Sichtbarkeit und Tastaturbedienbarkeit sicher.'
  ];

  const internalHtml = nunjucks.render('internal.njk', { ...summary });
  const publicHtml  = nunjucks.render('public.njk',  { ...summary, recommendations });

  await fs.writeFile(path.join(out, 'report_internal.html'), internalHtml, 'utf-8');
  await fs.writeFile(path.join(out, 'report_public.html'), publicHtml, 'utf-8');

  // Create PDFs by rendering the HTML in a blank page
  const pdfCtx = await browser.newContext();
  const pdfPage = await pdfCtx.newPage();
  await pdfPage.setViewportSize({ width: 1080, height: 1440 });

  // Internal PDF
  await pdfPage.setContent(internalHtml, { waitUntil: 'domcontentloaded' });
  await pdfPage.pdf({ path: path.join(out, 'report_internal.pdf'), format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });

  // Public PDF
  await pdfPage.setContent(publicHtml, { waitUntil: 'domcontentloaded' });
  await pdfPage.pdf({ path: path.join(out, 'report_public.pdf'), format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });

  await browser.close();
  console.log('✅ Done. Reports in:', out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
