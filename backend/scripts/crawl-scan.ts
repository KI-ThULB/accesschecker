/**
 * AccessChecker – Site Crawler + axe-core Scan (stabile ESM/TS-Version)
 * Ergebnisdateien (im Ordner ./out):
 *   - scan.json, pages.json, issues.json, downloads.json, downloads_report.json
 *
 * Env:
 *   START_URL (Pflicht), MAX_PAGES=50, CHECK_DOWNLOADS=true|false, OUTPUT_DIR=./out
 */

import path from "node:path";
import { chromium, Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { checkDownloads } from "../scanners/downloads.js";
import { promises as fs } from "node:fs";

// rules_mapping.json ohne TS-JSON-Import-Attr lesen (robust in ESM):
const rulesMapping: any[] = JSON.parse(
  await fs.readFile(new URL("../config/rules_mapping.json", import.meta.url), "utf-8")
);

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

function envBool(name: string, fallback: boolean): boolean {
  const v = (process.env[name] || "").toLowerCase().trim();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}
function normalizeUrl(u: string): string {
  try { const url = new URL(u); url.hash = ""; return url.toString(); } catch { return u; }
}
function sameOrigin(a: string, origin: string): boolean {
  try { return new URL(a).origin === origin; } catch { return false; }
}
function isHttp(u: string) { return /^https?:\/\//i.test(u); }
function isDownloadLink(u: string) { return /\.(pdf|docx?|pptx?)($|\?)/i.test(u); }
async function ensureDir(d: string) { await fs.mkdir(d, { recursive: true }); }

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

async function gentleInteractions(page: Page) {
  try {
    await page.$$eval("[aria-haspopup], [role=menuitem], button, summary",
      (els: Element[]) => { for (const el of els.slice(0, 10)) try { (el as HTMLElement).click(); } catch {} });
  } catch {}
  try {
    const tabs = await page.$$("[role='tab']");
    for (const t of tabs.slice(0, 6)) { try { await t.click(); await page.waitForTimeout(100); } catch {} }
  } catch {}
}

async function main() {
  const startUrlRaw = process.env.START_URL || "";
  if (!startUrlRaw) { console.error("❌ START_URL ist nicht gesetzt."); process.exit(2); }
  const START_URL = normalizeUrl(startUrlRaw);
  const ORIGIN = new URL(START_URL).origin;
  const MAX_PAGES = Number(process.env.MAX_PAGES || 50);
  const CHECK_DOWNLOADS = envBool("CHECK_DOWNLOADS", true);
  const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), "out");

  await ensureDir(OUTPUT_DIR);

  const visited = new Set<string>();
  const queue: string[] = [START_URL];
  const pageResults: PageResult[] = [];
  const downloadsFound = new Set<string>();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: "AccessCheckerBot/0.1" });
  const page = await context.newPage();

  while (queue.length && visited.size < MAX_PAGES) {
    const current = normalizeUrl(queue.shift()!);
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      console.log(`🔎 Scanne: ${current}`);
      await page.goto(current, { waitUntil: "networkidle", timeout: 45_000 });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(600);
      await gentleInteractions(page);

      const axe = new AxeBuilder({ page });
      const res = await axe.analyze();
      const violations: Violation[] = (res.violations || []) as any[];
      const incomplete: any[] = (res.incomplete || []) as any[];

      for (const v of violations) {
        const map = rulesMapping.find((m) => m.axeRuleId === v.id);
        if (map) {
          v.wcagRefs = map.wcagRefs || [];
          v.bitvRefs = map.bitvRefs || [];
          v.en301549Refs = map.en301549Refs || [];
          v.legalContext = map.legalContext || "";
        }
      }

      pageResults.push({ url: current, violations, incomplete });

      const links: string[] = await page.$$eval("a[href]", (els) =>
        (els as HTMLAnchorElement[]).map((a) => (a as any).href as string)
      );

      for (const raw of links) {
        if (!isHttp(raw)) continue;
        const href = normalizeUrl(raw);
        if (!sameOrigin(href, ORIGIN)) continue;
        if (isDownloadLink(href)) { downloadsFound.add(href); continue; }
        if (!visited.has(href) && !queue.includes(href)) queue.push(href);
      }
    } catch (e) {
      console.warn(`⚠️  Fehler beim Scannen von ${current}:`, (e as any)?.message || e);
    }
  }

  await browser.close();

  let downloadsReport: Array<{ url: string; type: string; checks: { name: string; passed: boolean; details?: string }[]; }> = [];
  if (CHECK_DOWNLOADS && downloadsFound.size) {
    const toCheck = Array.from(downloadsFound).slice(0, 25);
    try { downloadsReport = await checkDownloads(toCheck); }
    catch (e) { console.warn("⚠️  Download-Analyse fehlgeschlagen:", (e as any)?.message || e); }
  }

  const allViolations = pageResults.flatMap((p) => p.violations);
  const score = computeScore(allViolations);

  const summary = {
    startUrl: START_URL,
    date: new Date().toISOString(),
    pagesCrawled: visited.size,
    downloadsFound: downloadsFound.size,
    score,
    totals: {
      violations: allViolations.length,
      incomplete: pageResults.reduce((a, p) => a + p.incomplete.length, 0),
    },
  };

  await fs.writeFile(path.join(OUTPUT_DIR, "scan.json"), JSON.stringify(summary, null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "pages.json"), JSON.stringify(Array.from(visited), null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "issues.json"), JSON.stringify(allViolations, null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "downloads.json"), JSON.stringify(Array.from(downloadsFound), null, 2), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "downloads_report.json"), JSON.stringify(downloadsReport, null, 2), "utf-8");

  console.log("✅ Scan abgeschlossen. Artefakte in:", OUTPUT_DIR);
}

main().catch((err) => { console.error("❌ Unerwarteter Fehler:", err); process.exit(1); });
