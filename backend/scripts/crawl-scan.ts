import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { checkDownloads } from '../scanners/downloads';
import rulesMapping from '../config/rules_mapping.json';

interface PageResult {
  url: string;
  violations: any[];
}

(async () => {
  const startUrl = process.env.START_URL || 'https://example.com';
  const maxPages = Number(process.env.MAX_PAGES || 50);
  const checkDownloadsFlag = process.env.CHECK_DOWNLOADS === 'true';

  const visited = new Set<string>();
  const toVisit = [startUrl];
  const pageResults: PageResult[] = [];
  const downloadsFound: string[] = [];

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  while (toVisit.length > 0 && visited.size < maxPages) {
    const url = toVisit.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      console.log(`Scanning ${url}`);
      await page.goto(url, { waitUntil: 'networkidle' });

      // Dynamische Interaktionen
      await page.evaluate(() => {
        document.querySelectorAll('[aria-haspopup], nav button').forEach(el => (el as HTMLElement).click());
        document.querySelectorAll('[role="tab"]').forEach(el => (el as HTMLElement).click());
      });

      // Accessibility-Scan
      const axe = new AxeBuilder({ page });
      const results = await axe.analyze();

      // Norm-Mapping hinzufügen
      results.violations.forEach(v => {
        const mapEntry = (rulesMapping as any[]).find(r => r.axeRuleId === v.id);
        if (mapEntry) {
          (v as any).wcagRefs = mapEntry.wcagRefs;
          (v as any).bitvRefs = mapEntry.bitvRefs;
          (v as any).en301549Refs = mapEntry.en301549Refs;
          (v as any).legalContext = mapEntry.legalContext;
        }
      });

      pageResults.push({ url, violations: results.violations });

      // Links sammeln
      const links = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
      links.forEach(link => {
        if (link.startsWith(startUrl) && !visited.has(link) && !toVisit.includes(link)) {
          toVisit.push(link);
        }
      });

      // Downloads erkennen
      links.forEach(link => {
        if (/\.(pdf|docx|pptx)(\?.*)?$/i.test(link)) {
          downloadsFound.push(link);
        }
      });

    } catch (err) {
      console.error(`Error scanning ${url}:`, err);
    }
  }

  await browser.close();

  // Downloads prüfen
  let downloadsReport: any[] = [];
  if (checkDownloadsFlag && downloadsFound.length > 0) {
    downloadsReport = await checkDownloads(downloadsFound);
  }

  // Ergebnisse speichern
  const outDir = process.env.OUTPUT_DIR || path.join(process.cwd(), 'out');
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify([...visited], null, 2));
  fs.writeFileSync(path.join(outDir, 'issues.json'), JSON.stringify(pageResults.flatMap(p => p.violations), null, 2));
  fs.writeFileSync(path.join(outDir, 'downloads.json'), JSON.stringify(downloadsFound, null, 2));
  fs.writeFileSync(path.join(outDir, 'downloads_report.json'), JSON.stringify(downloadsReport, null, 2));
  fs.writeFileSync(path.join(outDir, 'scan.json'), JSON.stringify({
    startUrl,
    date: new Date().toISOString(),
    score: calcScore(pageResults),
    pagesCrawled: visited.size,
    downloadsFound: downloadsFound.length,
    totals: {
      violations: pageResults.reduce((sum, p) => sum + p.violations.length, 0),
      incomplete: 0
    }
  }, null, 2));

  console.log('Scan complete.');
})();

function calcScore(results: PageResult[]) {
  const totalViolations = results.reduce((sum, p) => sum + p.violations.length, 0);
  if (totalViolations === 0) return 100;
  return Math.max(0, 100 - totalViolations);
}
