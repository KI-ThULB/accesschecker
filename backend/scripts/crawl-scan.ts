import { program } from 'commander';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import nunjucks from 'nunjucks';
import { AxeBuilder } from '@axe-core/playwright';

type Defaults = {
  maxPages: number;
  maxDepth: number;
  timeoutMs: number;
  respectRobotsTxt: boolean;
  sameOriginOnly: boolean;
  waitAfterLoadMs: number;
  userAgent: string;
};

type AxeViolation = {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  help: string;
  tags: string[];
  nodes: { target: string[]; failureSummary: string }[];
};

type PageResult = {
  url: string;
  status: number | null;
  violations: AxeViolation[];
  incomplete: any[];
};

const DEFAULTS_PATH = path.join(process.cwd(), 'config', 'scan.defaults.json');

async function readDefaults(): Promise<Defaults> {
  const raw = await fs.readFile(DEFAULTS_PATH, 'utf-8');
  return JSON.parse(raw) as Defaults;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString();
  } catch {
    return u;
  }
}

function isHttpLink(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function sameOrigin(u: string, origin: string): boolean {
  try {
    return new URL(u).origin === origin;
  } catch {
    return false;
  }
}

function isDownloadLink(u: string): boolean {
  return /\.(pdf|docx?|pptx?)($|\?)/i.test(u);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readRobotsTxt(startUrl: string): Promise<{ disallow: string[] }> {
  try {
    const { origin } = new URL(startUrl);
    const res = await fetch(`${origin}/robots.txt`, { redirect: 'follow' } as any);
    if (!('ok' in res) || !(res as any).ok) return { disallow: [] };
    const txt = await (res as any).text();
    const lines = txt.split('\n').map((l: string) => l.trim());
    const disallow: string[] = [];
    let applies = false;
    for (const line of lines) {
      if (/^user-agent:\s*\*/i.test(line)) { applies = true; continue; }
      if (/^user-agent:/i.test(line)) { applies = false; continue; }
      if (applies) {
        const m = line.match(/^disallow:\s*(.*)$/i);
        if (m) disallow.push(m[1].trim());
      }
    }
    return { disallow };
  } catch {
    return { disallow: [] };
  }
}

function disallowed(urlStr: string, origin: string, rules: string[]): boolean {
  try {
    const u = new URL(urlStr);
    if (u.origin !== origin) return false;
    const p = u.pathname;
    return rules.some((rule) => rule !== '' && p.startsWith(rule));
  } catch {
    return false;
  }
}

function computeScore(allViolations: AxeViolation[]) {
  let score = 100;
  const weights: Record<string, number> = { critical: 5, serious: 3, moderate: 2, minor: 1 };
  for (const v of allViolations) {
    const w = weights[v.impact || 'moderate'] || 2;
    score -= Math.min(30, w * Math.min(5, v.nodes.length));
  }
  return Math.max(0, Math.min(100, score));
}

program
  .requiredOption('--start_url <url>', 'Start URL to crawl')
  .option('--out <dir>', 'Output directory', 'out')
  .option('--max_pages <n>', 'Max pages to scan', '')
  .option('--max_depth <n>', 'Max crawl depth', '')
  .option('--respect_robots <bool>', 'Respect robots.txt', '')
  .option('--same_origin <bool>', 'Limit to same origin', '');

program.parse(process.argv);
const opts = program.opts<{
  start_url: string; out: string;
  max_pages?: string; max_depth?: string;
  respect_robots?: string; same_origin?: string;
}>();

async function main() {
  const defaults = await readDefaults();
  const cfg = {
    maxPages: opts.max_pages ? Number(opts.max_pages) : defaults.maxPages,
    maxDepth: opts.max_depth ? Number(opts.max_depth) : defaults.maxDepth,
    respectRobotsTxt: opts.respect_robots ? opts.respect_robots === 'true' : defaults.respectRobotsTxt,
    sameOriginOnly: opts.same_origin ? opts.same_origin === 'true' : defaults.sameOriginOnly,
    timeoutMs: defaults.timeoutMs,
    waitAfterLoadMs: defaults.waitAfterLoadMs,
    userAgent: defaults.userAgent
  };

  const startUrl = normalizeUrl(opts.start_url);
  const origin = new URL(startUrl).origin;
  const outDir = opts.out;

  await ensureDir(outDir);

  const robots = cfg.respectRobotsTxt ? await readRobotsTxt(startUrl) : { disallow: [] };
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const pages: string[] = [];
  const downloads: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: cfg.userAgent });
  const page = await context.newPage();

  const results: PageResult[] = [];

  while (queue.length && visited.size < cfg.maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    if (cfg.respectRobotsTxt && disallowed(url, origin, robots.disallow)) {
      continue;
    }

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: cfg.timeoutMs });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(cfg.waitAfterLoadMs);

      // axe-core
      const axe = new AxeBuilder({ page });
      const axeRes = await axe.analyze();
      const violations = (axeRes.violations || []) as AxeViolation[];
      const incomplete = (axeRes.incomplete || []) as any[];
      results.push({ url, status: 200, violations, incomplete });
      pages.push(url);

      // Links sammeln
      const links: string[] = await page.$$eval('a[href]', (as) =>
        as.map((a) => (a as HTMLAnchorElement).href)
      );

      for (const raw of links) {
        if (!isHttpLink(raw)) continue;
        const href = normalizeUrl(raw);
        if (cfg.sameOriginOnly && !sameOrigin(href, origin)) continue;

        if (isDownloadLink(href)) {
          downloads.push(href);
          continue;
        }
        if (depth + 1 <= cfg.maxDepth && !visited.has(href)) {
          queue.push({ url: href, depth: depth + 1 });
        }
      }
    } catch {
      results.push({ url, status: null, violations: [], incomplete: [] });
    }
  }

  await browser.close();

  // Aggregation
  const allViolations = results.flatMap((r) => r.violations);
  const score = computeScore(allViolations);
  const date = new Date().toISOString();

  const summary = {
    startUrl,
    date,
    pagesCrawled: pages.length,
    downloadsFound: downloads.length,
    score,
    totals: {
      violations: allViolations.length,
      incomplete: results.reduce((a, r) => a + r.incomplete.length, 0)
    }
  };

  // Persist JSON artefacts
  await fs.writeFile(path.join(outDir, 'scan.json'), JSON.stringify(summary, null, 2), 'utf-8');
  await fs.writeFile(path.join(outDir, 'pages.json'), JSON.stringify(pages, null, 2), 'utf-8');
  await fs.writeFile(path.join(outDir, 'issues.json'), JSON.stringify(allViolations, null, 2), 'utf-8');
  await fs.writeFile(path.join(outDir, 'downloads.json'), JSON.stringify(downloads, null, 2), 'utf-8');

  // Render Reports (reuse existing templates)
  nunjucks.configure(path.join(process.cwd(), 'reports', 'templates'), { autoescape: true });

  const recommendations = [
    'Erhöhen Sie Kontraste auf mindestens 4.5:1 (Normaltext).',
    'Beschriften Sie Formularelemente (label + name/role).',
    'Stellen Sie Fokus-Sichtbarkeit und Tastaturbedienbarkeit sicher.'
  ];

  const internalHtml = nunjucks.render('internal.njk', {
    url: startUrl,
    date,
    score,
    totals: summary.totals,
    violations: allViolations
  });

  const publicHtml = nunjucks.render('public.njk', {
    url: startUrl,
    date,
    score,
    recommendations
  });

  const browser2 = await chromium.launch({ headless: true });
  const ctx2 = await browser2.newContext();
  const pdfPage = await ctx2.newPage();
  await pdfPage.setViewportSize({ width: 1080, height: 1440 });

  await pdfPage.setContent(internalHtml, { waitUntil: 'domcontentloaded' });
  await pdfPage.pdf({
    path: path.join(outDir, 'report_internal.pdf'),
    format: 'A4',
    margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' }
  });

  await pdfPage.setContent(publicHtml, { waitUntil: 'domcontentloaded' });
  await pdfPage.pdf({
    path: path.join(outDir, 'report_public.pdf'),
    format: 'A4',
    margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' }
  });

  await browser2.close();

  console.log('✅ Site scan done. Output in:', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
