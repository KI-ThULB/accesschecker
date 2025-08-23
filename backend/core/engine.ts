import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { getModules } from './registry.js';
import type { ModuleContext, ModuleResult, ScanResults, Issue, DownloadFinding } from './types.js';

export async function main() {
  const config = await loadConfig();
  const outDir = path.join(process.cwd(), 'out');
  await fs.mkdir(outDir, { recursive: true });
  const modules = await getModules([], config.profile, config);
  const start = new Date();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  if (config.url) await page.goto(config.url);

  const moduleResults: Record<string, ModuleResult> = {};
  const issues: Issue[] = [];
  let downloads: DownloadFinding[] = [];

  const ctx: ModuleContext = {
    page,
    url: config.url || '',
    crawlGraph: [],
    config,
    log: () => {},
    saveArtifact: async (name, data) => {
      const file = path.join(outDir, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(data, null, 2));
      return file;
    }
  };

  for (const mod of modules) {
    try {
      if (mod.init) await mod.init(ctx);
      const res = await mod.run(ctx);
      moduleResults[mod.slug] = res;
      issues.push(...res.findings);
      if (mod.slug === 'downloads') {
        downloads = res.findings;
      }
      if (mod.dispose) await mod.dispose(ctx);
    } catch (e) {
      ctx.log({ level: 'error', module: mod.slug, url: ctx.url, msg: String(e) });
    }
  }
  await browser.close();
  const finished = new Date();

  const results: ScanResults = {
    meta: {
      startedAt: start.toISOString(),
      finishedAt: finished.toISOString(),
      target: config.url || '',
      profile: config.profile
    },
    score: { overall: 0 },
    modules: moduleResults,
    issues,
    pages: [{ url: config.url || '' }],
    ...(downloads.length ? { downloads: downloads as any } : {})
  };
  await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(outDir, 'issues.json'), JSON.stringify(issues, null, 2));
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
