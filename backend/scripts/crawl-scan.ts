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
  nodes?: { target: string[]; failureSummary?: string }[];
  wcagRefs?: string[];
  bitvRefs?: string[];
  en301549Refs?: string[];
  legalContext?: string;
};

type PageResult = { url: string; violations: Violation[]; incomplete: any[] };
type QueueItem = { url: string; depth: number };

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
function isDownloadLink(u: string) { return /\.(pdf|docx?|pptx?)($|\?)/i.test(u); }
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

function computeScore(violations: Violation[]): number {
  let score = 100;
  const weights: Record<string, number> = { critical: 6, serious: 4, moderate: 2, minor: 1 };
  for (const v of violations) {
    const w = weights[v.impact || "moderate"] || 2;
    const count = Math.min(5, v.nodes?.length ?? 1);
    score -= Math.min(35, w * count);
  }
  return Math.max(0, Math.min(100, score));
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

async function gentleInteractions(page: Page) {
  try {
    // Details ausklappen
    await page.$$eval("details:not([open])", (els: Element[]) => els.slice(0, 8).forEach((el: any) => { try { el.open = true; } catch {} }));
  } catch {}
  try {
    // ARIA-Trigger klicken
    await page.$$eval("[aria-haspopup], [role=menuitem], button, summary",
      (els: Element[]) => { for (const el of els.slice(0, 12)) try { (el as HTMLElement).click(); } catch {} });
  } catch {}
  try {
    // Tabs wechseln
    const tabs = await page.$$("[role='tab']");
    for (const t of tabs.slice(0, 6)) { try { await t.click(); await page.waitForTimeout(120); } catch {} }
  } catch {}
  try {
    // Akkordeons / mehr anzeigen
    await page.$$eval("[aria-expanded='false'], [data-accordion], a, button",
      (els: Element[]) => {
        const hits = (els as HTMLElement[]).filter(el => /mehr anzeigen|weiterlesen|more/i.test(el.innerText || ""));
        for (const el of hits.slice(0, 6)) { try { (el as HTMLElement).click(); } catch {} }
      });
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

  while (queue.length && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    if (respectRobotsTxt && disallowed(url, origin, disallow)) continue;
    visited.add(url);

    try {
      console.log(`🔎 Scanne [d=${depth}]: ${url}`);
      await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

      if (consentClick) { await clickConsent(page); }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(WAIT_AFTER_LOAD);
      await gentleInteractions(page);

      const axe = new AxeBuilder({ page });
      const res = await axe.analyze();
      const violations: Violation[] = (res.violations || []) as any[];
      const incomplete: any[] = (res.incomplete || []) as any[];

      // Normverweise (optional – falls rules_mapping gepflegt wird)
      try {
        const mapArr: any[] = JSON.parse(
          await fs.readFile(new URL("../config/rules_mapping.json", import.meta.url), "utf-8")
        );
        const byId: Record<string, any> = {};
        for (const m of mapArr) byId[m.axeRuleId] = m;
        for (const v of violations) {
          const m = byId[v.id];
          if (m) {
            v.wcagRefs = m.wcagRefs || [];
            v.bitvRefs = m.bitvRefs || [];
            v.en301549Refs = m.en301549Refs || [];
            v.legalContext = m.legalContext || "";
          }
        }
      } catch {}

      pageResults.push({ url, violations, incomplete });

      // Links sammeln
      const links: string[] = await page.$$eval("a[href]", (els) =>
        (els as HTMLAnchorElement[]).map((a) => (a as any).href as string)
      );
      for (const raw of links) {
        if (!isHttp(raw)) continue;
        const href = normalizeUrl(raw, stripHash);
        if (sameOriginOnly && !sameOrigin(href, origin)) continue;
        if (isDownloadLink(href)) { downloads.add(href); continue; }
        if (depth + 1 <= MAX_DEPTH && !visited.has(href) && !queue.find(q => q.url === href)) {
          queue.push({ url: href, depth: depth + 1 });
        }
      }

      // iframes als eigene Seiten scannen (nur gleiche Origin)
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

    // kleine zufällige Wartezeit (Rate-Limiting)
    await sleep(randInt(WAIT_MIN, WAIT_MAX));
  }

  await browser.close();

  // Downloads prüfen
  let downloadsReport: any[] = [];
  if (downloads.size) {
    try {
      downloadsReport = await checkDownloads(Array.from(downloads).slice(0, 50));
    } catch (e) {
      console.warn("⚠️  Downloads konnten nicht geprüft werden:", (e as any)?.message || e);
    }
  }

  const allViolations = pageResults.flatMap(p => p.violations);
  const score = computeScore(allViolations);

  const summary = {
    startUrl: START_URL,
    date: new Date().toISOString(),
    pagesCrawled: visited.size,
    downloadsFound: downloads.size,
    score,
    totals: {
      violations: allViolations.length,
      incomplete: pageResults.reduce((a, p) => a + p.incomplete.length, 0)
    }
  };

  await fs.writeFile(path.join(OUTPUT_DIR, "scan.json"), JSON.stringify(summary, null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "pages.json"), JSON.stringify(Array.from(visited), null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "issues.json"), JSON.stringify(allViolations, null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "downloads.json"), JSON.stringify(Array.from(downloads), null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "downloads_report.json"), JSON.stringify(downloadsReport, null, 2), "utf-8");

  console.log("✅ Scan abgeschlossen. Artefakte in:", OUTPUT_DIR);
}

main().catch((err) => { console.error("❌ Unerwarteter Fehler:", err); process.exit(1); });
