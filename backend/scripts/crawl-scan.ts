/**
 * AccessChecker – erweiterter Site-Crawler + axe-core Scan
 * Abdeckung:
 *  - Same-Origin BFS mit Tiefe, optional Hash-Routen
 *  - robots.txt (User-agent: *) optional
 *  - sitemap.xml seeden (optional)
 *  - dynamische Interaktionen (Tabs/Menüs/Accordions/Details)
 *  - Consent-Buttons (DE/EN) optional
 *  - iframes: URLs gleiche Origin in Queue aufnehmen (optional)
 *  - Downloads (pdf/doc/docx/ppt/pptx) sammeln
 *
 * Artefakte in ./out: scan.json, pages.json, issues.json, downloads.json, downloads_report.json
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import fetch from "node-fetch";
import { chromium, Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { checkDownloads } from "../scanners/downloads.js";
import type { Issue } from "../types/Issue.js";
import type { DownloadFinding } from "../types/DownloadFinding.js";

// Defaults lesen (robust, ohne TS-assert JSON)
async function readDefaults() {
  try {
    const p = new URL("../config/scan.defaults.json", import.meta.url);
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return {};
  }
}
type Defaults = {
  sameOriginOnly: boolean;
  respectRobotsTxt: boolean;
  seedSitemap: boolean;
  respectHashRoutes: boolean;
  checkIframes: boolean;
  consentClick: boolean;
  maxPages: number;
  maxDepth: number;
  timeoutMs: number;
  waitAfterLoadMs: number;
  waitMinMs: number;
  waitMaxMs: number;
  userAgent: string;
};

type Violation = {
  id: string;
  impact?: "minor" | "moderate" | "serious" | "critical";
  help?: string;
  helpUrl?: string;
  nodes?: { target: string[]; html?: string; failureSummary?: string }[];
  wcagRefs?: string[];
  bitvRefs?: string[];
  en301549Refs?: string[];
  legalContext?: string;
};

type PageResult = { url: string; violations: Violation[]; incomplete: any[] };
type QueueItem = { url: string; depth: number };
type InteractionLog = { url: string; action: string; selector: string; timestamp: string };

function envBool(name: string, fallback: boolean): boolean {
  const v = (process.env[name] || "").toLowerCase().trim();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name] || "");
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function normalizeUrl(u: string, stripHash: boolean): string {
  try {
    const url = new URL(u);
    if (stripHash) url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}
function isHttp(u: string) { return /^https?:\/\//i.test(u); }
function sameOrigin(a: string, origin: string): boolean {
  try { return new URL(a).origin === origin; } catch { return false; }
}
function isDownloadLink(u: string) { return /\.(pdf|docx?|pptx?|csv|txt)($|\?)/i.test(u); }
async function ensureDir(dir: string) { await fs.mkdir(dir, { recursive: true }); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randInt(min: number, max: number) { return Math.floor(min + Math.random() * (max - min + 1)); }

async function readRobots(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { redirect: "follow" });
    if (!res.ok) return [];
    const txt = await res.text();
    const lines = txt.split(/\r?\n/);
    const dis: string[] = [];
    let applies = false;
    for (const line of lines) {
      const l = line.trim();
      if (/^user-agent:\s*\*/i.test(l)) { applies = true; continue; }
      if (/^user-agent:/i.test(l)) { applies = false; continue; }
      if (applies) {
        const m = l.match(/^disallow:\s*(.*)$/i);
        if (m) dis.push(m[1].trim());
      }
    }
    return dis.filter(Boolean);
  } catch { return []; }
}
function disallowed(urlStr: string, origin: string, rules: string[]): boolean {
  try {
    const u = new URL(urlStr);
    if (u.origin !== origin) return false;
    return rules.some(r => r !== "" && u.pathname.startsWith(r));
  } catch { return false; }
}

async function readSitemap(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/sitemap.xml`, { redirect: "follow" });
    if (!res.ok) return [];
    const xml = await res.text();
    // simple <loc> extractor
    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map(m => m[1]);
    return locs.filter(isHttp);
  } catch { return []; }
}

type Severity = "critical" | "serious" | "moderate" | "minor";
function computeScore(issues: Issue[]) {
  const weights: Record<Severity, number> = {
    critical: -5,
    serious: -3,
    moderate: -2,
    minor: -1,
  };
  const counts: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  for (const i of issues) {
    const sev = (i.impact || "moderate") as Severity;
    counts[sev] += 1;
  }
  let score = 100;
  for (const sev of Object.keys(counts) as Severity[]) {
    score += counts[sev] * weights[sev];
  }
  if (score < 0) score = 0;
  return { overall: score, bySeverity: counts };
}

async function clickConsent(page: Page) {
  // klickt gängige DE/EN Texte
  const labels = [
    "Alle akzeptieren", "Akzeptieren", "Zustimmen", "Einverstanden",
    "Accept all", "Accept", "I agree", "Agree", "Allow all"
  ];
  try {
    await page.evaluate((labelsIn) => {
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"));
      function norm(s: string) { return s.replace(/\s+/g, " ").trim().toLowerCase(); }
      for (const el of candidates as HTMLElement[]) {
        const txt = norm(el.innerText || (el.getAttribute("aria-label") || ""));
        if (labelsIn.some((l: string) => txt.includes(l.toLowerCase()))) {
          (el as HTMLElement).click();
        }
      }
    }, labels);
  } catch {}
}

async function autoScroll(page: Page, log: (a: string, s: string) => void, wait: number) {
  let lastHeight = -1;
  for (let i = 0; i < 10; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    log('scroll', 'window');
    await page.waitForTimeout(wait);
    const nh = await page.evaluate(() => document.body.scrollHeight);
    if (nh === h || nh === lastHeight) break;
    lastHeight = nh;
  }
}

async function gentleInteractions(page: Page, log: (a: string, s: string) => void) {
  try {
    const details = await page.$$("details:not([open])");
    for (const el of details.slice(0, 8)) {
      try {
        const sel = await el.evaluate(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
        await el.evaluate((e: any) => { e.open = true; });
        log('open-details', sel);
      } catch {}
    }
  } catch {}
  try {
    const triggers = await page.$$("[aria-haspopup], [role=menuitem], button, summary");
    for (const el of triggers.slice(0, 12)) {
      try {
        const sel = await el.evaluate(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
        await el.click();
        log('click', sel);
      } catch {}
    }
  } catch {}
  try {
    const accs = await page.$$('[data-accordion]');
    for (const el of accs.slice(0, 6)) {
      try {
        const sel = await el.evaluate(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
        await el.click();
        log('accordion-toggle', sel);
      } catch {}
    }
  } catch {}
  try {
    const tabs = await page.$$("[role='tab']");
    for (const t of tabs.slice(0, 6)) {
      try {
        const sel = await t.evaluate(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
        await t.click();
        log('tab-switch', sel);
        await page.waitForTimeout(120);
      } catch {}
    }
  } catch {}
  try {
    const hits = await page.$$('[aria-expanded="false"], [data-accordion], a, button');
    const filtered = [] as any[];
    for (const el of hits) {
      try {
        const text = await el.evaluate((e: any) => (e as HTMLElement).innerText || '');
        if (/mehr anzeigen|weiterlesen|more/i.test(text)) filtered.push(el);
      } catch {}
    }
    for (const el of filtered.slice(0, 6)) {
      try {
        const sel = await el.evaluate((e: any) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
        await el.click();
        log('expand', sel);
      } catch {}
    }
  } catch {}
  try {
    const dialogs = await page.$$("dialog:not([open])");
    for (const el of dialogs.slice(0, 2)) {
      try {
        const sel = await el.evaluate(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
        await el.evaluate((e: any) => e.showModal?.());
        log('open-dialog', sel);
        await page.keyboard.press('Escape');
        log('close-dialog', sel);
      } catch {}
    }
  } catch {}
}

async function main() {
  const defaults: Defaults = await readDefaults();

  const START_URL = (process.env.START_URL || "").trim();
  if (!START_URL) { console.error("❌ START_URL ist nicht gesetzt."); process.exit(2); }

  const sameOriginOnly = envBool("SAME_ORIGIN_ONLY", defaults.sameOriginOnly ?? true);
  const respectRobotsTxt = envBool("RESPECT_ROBOTS", defaults.respectRobotsTxt ?? true);
  const seedSitemap = envBool("SEED_SITEMAP", defaults.seedSitemap ?? true);
  const respectHashRoutes = envBool("RESPECT_HASH_ROUTES", defaults.respectHashRoutes ?? true);
  const checkIframes = envBool("CHECK_IFRAMES", defaults.checkIframes ?? true);
  const consentClick = envBool("CONSENT_CLICK", defaults.consentClick ?? true);

  const MAX_PAGES = envNum("MAX_PAGES", defaults.maxPages ?? 50);
  const MAX_DEPTH = envNum("MAX_DEPTH", defaults.maxDepth ?? 3);
  const TIMEOUT_MS = envNum("TIMEOUT_MS", defaults.timeoutMs ?? 45000);
  const WAIT_AFTER_LOAD = envNum("WAIT_AFTER_LOAD_MS", defaults.waitAfterLoadMs ?? 600);
  const WAIT_MIN = envNum("WAIT_MIN_MS", defaults.waitMinMs ?? 200);
  const WAIT_MAX = envNum("WAIT_MAX_MS", defaults.waitMaxMs ?? 600);

  const stripHash = !respectHashRoutes;
  const origin = new URL(START_URL).origin;
  const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), "out");
  await ensureDir(OUTPUT_DIR);

  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: normalizeUrl(START_URL, stripHash), depth: 0 }];
  const downloads = new Set<string>();
  const pageResults: PageResult[] = [];
  const issues: Issue[] = [];
  const interactionLogs: InteractionLog[] = [];

  // robots + sitemap
  const disallow = respectRobotsTxt ? await readRobots(origin) : [];
  if (seedSitemap) {
    for (const u of await readSitemap(origin)) {
      const n = normalizeUrl(u, stripHash);
      if ((!sameOriginOnly || sameOrigin(n, origin)) && !visited.has(n)) queue.push({ url: n, depth: 0 });
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: defaults.userAgent || "AccessCheckerBot/0.2 (+https://example.invalid)" });
  const page = await context.newPage();
  const logInteraction = (action: string, selector: string) => {
    interactionLogs.push({ url: page.url(), action, selector, timestamp: new Date().toISOString() });
  };
  await page.exposeFunction('acsRecordRoute', (href: string) => {
    interactionLogs.push({ url: href, action: 'route-change', selector: '', timestamp: new Date().toISOString() });
  });
  await page.addInitScript(() => {
    (window as any).__acsRoutes = [];
    const record = () => {
      try { (window as any).__acsRoutes.push(location.href); (window as any).acsRecordRoute?.(location.href); } catch {}
    };
    const push = history.pushState;
    history.pushState = function (...args: any[]) {
      (push as any).apply(this, args as any);
      record();
    };
    const rep = history.replaceState;
    history.replaceState = function (...args: any[]) {
      (rep as any).apply(this, args as any);
      record();
    };
    window.addEventListener('hashchange', record, { capture: true });
  });

  try {
    while (queue.length && visited.size < MAX_PAGES) {
      const { url, depth } = queue.shift()!;
      if (visited.has(url)) continue;
      if (respectRobotsTxt && disallowed(url, origin, disallow)) continue;
      visited.add(url);

      try {
        const startT = Date.now();
        console.log(JSON.stringify({ level: 'info', msg: 'scan-start', url, depth }));
        const resp = await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

        let metaRobots = "";
        try { metaRobots = (await page.$eval("meta[name='robots']", el => el.getAttribute("content") || "")).toLowerCase(); } catch {}
        if (metaRobots && /noindex|nofollow/.test(metaRobots)) {
          console.log(`ℹ️  meta robots ("${metaRobots}") bei ${url} – wird trotzdem geprüft.`);
        }
        const xRobots = (resp?.headers()["x-robots-tag"] || "").toLowerCase();
        if (xRobots && /noindex|nofollow/.test(xRobots)) {
          console.log(`ℹ️  X-Robots-Tag ("${xRobots}") bei ${url} – wird trotzdem geprüft.`);
        }

        if (consentClick) { await clickConsent(page); }
        await autoScroll(page, logInteraction, WAIT_AFTER_LOAD);
        await gentleInteractions(page, logInteraction);

        const axe = new AxeBuilder({ page });
        const res = await axe.analyze();
        const violations: Violation[] = (res.violations || []) as any[];
        const incomplete: any[] = (res.incomplete || []) as any[];

        try {
          const mapArr: any[] = JSON.parse(
            await fs.readFile(new URL("../config/rules_mapping.json", import.meta.url), "utf-8")
          );
          const byId: Record<string, any> = {};
          for (const m of mapArr) byId[m.axeRuleId] = m;
          for (const v of violations) {
            const m = byId[v.id];
            if (m) {
              v.wcagRefs = m.wcag || [];
              v.bitvRefs = m.bitv || [];
              v.en301549Refs = m.en301549 || [];
              v.legalContext = m.legalContext || "";
              if (!v.impact && m.impactDefault) v.impact = m.impactDefault;
            }
            const examples = (v.nodes || []).slice(0, 3).map(n => ({
              selector: n.target?.[0] || '',
              context: (n.html || '').replace(/<[^>]+>/g, '').trim().slice(0, 120),
              pageUrl: url,
            }));
            while (examples.length < 3) {
              examples.push({ selector: '', context: '', pageUrl: url });
            }
            issues.push({
              ruleId: v.id,
              description: v.help || '',
              impact: v.impact,
              helpUrl: v.helpUrl || '',
              pageUrl: url,
              wcag: v.wcagRefs || [],
              en301549: v.en301549Refs || [],
              bitv: v.bitvRefs || [],
              legalContext: v.legalContext || '',
              examples,
            });
          }
        } catch {}

        pageResults.push({ url, violations, incomplete });
        console.log(JSON.stringify({ level: 'info', msg: 'scan-finished', url, durationMs: Date.now() - startT, violations: violations.length }));

        const links: string[] = await page.$$eval("a[href]", (els) =>
          (els as HTMLAnchorElement[]).map((a) => (a as any).href as string)
        );
        let extraLinks: string[] = [];
        try {
          extraLinks = await page.evaluate(() => {
            const out = new Set<string>();
            const toAbs = (u: string) => {
              try { return new URL(u, document.baseURI).toString(); } catch { return ""; }
            };
            document.querySelectorAll('[data-href],[data-url],[routerlink],[role="link"]').forEach(el => {
              const href = (el.getAttribute('href') || (el as HTMLElement).dataset.href || (el as HTMLElement).dataset.url || el.getAttribute('routerlink')) || '';
              const u = toAbs(href);
              if (u) out.add(u);
            });
            document.querySelectorAll('[onclick]').forEach(el => {
              const attr = el.getAttribute('onclick') || '';
              const m = attr.match(/(?:location\.href|window\.location(?:\.href)?)\s*=\s*['"]([^'"\s]+)['"]/i);
              if (m) {
                const u = toAbs(m[1]);
                if (u) out.add(u);
              }
            });
            return Array.from(out);
          });
        } catch {}
        const allLinks = links.concat(extraLinks);
        for (const raw of allLinks) {
          if (!isHttp(raw)) continue;
          const href = normalizeUrl(raw, stripHash);
          if (sameOriginOnly && !sameOrigin(href, origin)) continue;
          if (isDownloadLink(href)) { downloads.add(href); continue; }
          if (depth + 1 <= MAX_DEPTH && !visited.has(href) && !queue.find(q => q.url === href)) {
            queue.push({ url: href, depth: depth + 1 });
          }
        }

        try {
          const spaRoutes: string[] = await page.evaluate(() => {
            const r = (window as any).__acsRoutes || [];
            (window as any).__acsRoutes = [];
            return r;
          });
          for (const raw of spaRoutes) {
            if (!isHttp(raw)) continue;
            const href = normalizeUrl(raw, stripHash);
            if (sameOriginOnly && !sameOrigin(href, origin)) continue;
            if (isDownloadLink(href)) { downloads.add(href); continue; }
            if (depth + 1 <= MAX_DEPTH && !visited.has(href) && !queue.find(q => q.url === href)) {
              queue.push({ url: href, depth: depth + 1 });
            }
          }
        } catch {}

        if (checkIframes) {
          for (const f of page.frames()) {
            const fu = f.url();
            if (!isHttp(fu)) continue;
            const fUrl = normalizeUrl(fu, stripHash);
            if (sameOriginOnly && !sameOrigin(fUrl, origin)) continue;
            if (!visited.has(fUrl) && !queue.find(q => q.url === fUrl)) {
              queue.push({ url: fUrl, depth: depth + 1 });
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️  Scan-Fehler bei ${url}:`, (e as any)?.message || e);
      }

      await sleep(randInt(WAIT_MIN, WAIT_MAX));
    }

    let downloadsReport: DownloadFinding[] = [];
    if (downloads.size) {
      try {
        downloadsReport = await checkDownloads(Array.from(downloads).slice(0, 50));
      } catch (e) {
        console.warn("⚠️  Downloads konnten nicht geprüft werden:", (e as any)?.message || e);
      }
    }

    const score = computeScore(issues);

    const summary = {
      startUrl: START_URL,
      date: new Date().toISOString(),
      pagesCrawled: visited.size,
      downloadsFound: downloads.size,
      score,
      totals: {
        violations: issues.length,
        incomplete: pageResults.reduce((a, p) => a + p.incomplete.length, 0)
      }
    };

    await fs.writeFile(path.join(OUTPUT_DIR, "scan.json"), JSON.stringify(summary, null, 2), "utf-8");
    await fs.writeFile(path.join(OUTPUT_DIR, "pages.json"), JSON.stringify(Array.from(visited), null, 2), "utf-8");
    await fs.writeFile(path.join(OUTPUT_DIR, "issues.json"), JSON.stringify(issues, null, 2), "utf-8");
    await fs.writeFile(path.join(OUTPUT_DIR, "downloads.json"), JSON.stringify(Array.from(downloads), null, 2), "utf-8");
    await fs.writeFile(path.join(OUTPUT_DIR, "downloads_report.json"), JSON.stringify(downloadsReport, null, 2), "utf-8");
  }
  finally {
    try { await browser.close(); } catch {}
    try { await fs.writeFile(path.join(OUTPUT_DIR, "dynamic_interactions.json"), JSON.stringify(interactionLogs, null, 2), "utf-8"); } catch {}
  }

  console.log("✅ Scan abgeschlossen. Artefakte in:", OUTPUT_DIR);
}

main().catch((err) => { console.error("❌ Unerwarteter Fehler:", err); process.exit(1); });
