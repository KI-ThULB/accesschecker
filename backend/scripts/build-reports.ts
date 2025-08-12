/**
 * Baut aus den JSON-Ergebnissen HTML + PDF (intern/öffentlich) in backend/out/.
 * Voraussetzung: Playwright ist bereits installiert (im Workflow sowieso).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

type ScanSummary = {
  startUrl: string;
  date: string;
  pagesCrawled: number;
  downloadsFound: number;
  score: number;
  totals: { violations: number; incomplete: number };
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[m]);
}

function renderInternalHTML(summary: ScanSummary, issues: any[], downloadsReport: any[]) {
  const rows = issues.slice(0, 200).map((v: any) => {
    const targets = (v.nodes || []).slice(0, 3).map((n: any) => `<code>${escapeHtml((n.target?.[0]||"").toString())}</code>`).join("<br/>");
    const wcag = (v.wcagRefs || []).join(", ");
    const bitv = (v.bitvRefs || []).join(", ");
    const en = (v.en301549Refs || []).join(", ");
    return `<tr>
      <td><b>${escapeHtml(v.id||"")}</b><br/><small>${escapeHtml(v.help||"")}</small></td>
      <td>${escapeHtml(v.impact||"n/a")}</td>
      <td><small>WCAG: ${escapeHtml(wcag)}<br/>BITV: ${escapeHtml(bitv)}<br/>EN: ${escapeHtml(en)}</small></td>
      <td>${targets}</td>
    </tr>`;
  }).join("");

  const dlRows = (downloadsReport||[]).map((d: any) => {
    const checks = (d.checks||[]).map((c:any)=>`<li>${escapeHtml(c.name)}: ${c.passed?"✔︎":"✘"}${c.details?` – ${escapeHtml(c.details)}`:""}</li>`).join("");
    return `<tr>
      <td><a href="${escapeHtml(d.url)}">${escapeHtml(d.url)}</a></td>
      <td>${escapeHtml((d.type||"").toUpperCase())}</td>
      <td>${d.ok?"OK":"<b>Nicht bestanden</b>"}</td>
      <td><ul>${checks}</ul></td>
    </tr>`;
  }).join("");

  return `<!doctype html><html lang="de"><head>
    <meta charset="utf-8"/>
    <title>Interner Barrierefreiheitsbericht</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px}
      table{border-collapse:collapse;width:100%;margin:12px 0 24px}
      th,td{border:1px solid #ddd;padding:8px;vertical-align:top}
      th{background:#f6f7f9}
      .badge{display:inline-block;padding:6px 10px;border-radius:8px;color:#fff;font-weight:700}
      .green{background:#1f8a3b}.yellow{background:#b58900}.red{background:#d11a2a}
      small{color:#555}
    </style>
  </head><body>
    <h1>Interner Barrierefreiheitsbericht</h1>
    <p><b>Ziel-URL:</b> ${escapeHtml(summary.startUrl)}<br/>
       <b>Datum:</b> ${escapeHtml(summary.date)}<br/>
       <b>Seiten:</b> ${summary.pagesCrawled} • <b>Downloads:</b> ${summary.downloadsFound}</p>
    <p><b>Gesamt:</b> 
      ${summary.score >= 90 ? '<span class="badge green">GRÜN</span>' :
        summary.score >= 75 ? '<span class="badge yellow">GELB</span>' : '<span class="badge red">ROT</span>'}
      &nbsp;Score: ${summary.score}/100 • Verstöße: ${summary.totals.violations} • Warnungen: ${summary.totals.incomplete}
    </p>

    <h2>Details (axe-core mit Normbezug)</h2>
    <table>
      <thead><tr><th>Regel</th><th>Schwere</th><th>Normbezug</th><th>Beispiele</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4"><small>Keine Verstöße ermittelt.</small></td></tr>'}</tbody>
    </table>

    <h2>Prüfung von Downloads</h2>
    <table>
      <thead><tr><th>Datei</th><th>Typ</th><th>Status</th><th>Checks</th></tr></thead>
      <tbody>${dlRows || '<tr><td colspan="4"><small>Keine prüfbaren Downloads.</small></td></tr>'}</tbody>
    </table>

    <p><small>Hinweis: Automatisierte Prüfung (axe-core, heuristische Datei-Checks). Für Rechtsverbindlichkeit ggf. ergänzende Prüfungen.</small></p>
  </body></html>`;
}

function renderPublicHTML(summary: ScanSummary, issues: any[], downloadsReport: any[]) {
  const top = issues.slice(0, 10).map((v:any)=>`<li>${escapeHtml(v.help||v.id||"")} (WCAG: ${(v.wcagRefs||[]).join(", ")})</li>`).join("");

  return `<!doctype html><html lang="de"><head>
    <meta charset="utf-8"/>
    <title>Öffentlicher Kurzbericht – Barrierefreiheit</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px}
      .badge{display:inline-block;padding:6px 10px;border-radius:8px;color:#fff;font-weight:700}
      .green{background:#1f8a3b}.yellow{background:#b58900}.red{background:#d11a2a}
      small{color:#555}
    </style>
  </head><body>
    <h1>Öffentlicher Kurzbericht</h1>
    <p><b>Ziel-URL:</b> ${escapeHtml(summary.startUrl)}<br/>
       <b>Datum:</b> ${escapeHtml(summary.date)}</p>
    <p>${summary.score >= 90 ? '<span class="badge green">GRÜN</span>' :
        summary.score >= 75 ? '<span class="badge yellow">GELB</span>' : '<span class="badge red">ROT</span>'}
       &nbsp;Gesamtbewertung: <b>${summary.score}/100</b></p>

    <h2>Wesentliche Befunde</h2>
    <ul>${top || '<li><small>Keine prioritären Befunde.</small></li>'}</ul>
    ${issues.length>10 ? `<p><small>… weitere ${issues.length-10} Befunde im internen Bericht.</small></p>` : ""}

    <h2>Downloads</h2>
    <p>Geprüfte Dateien: <b>${downloadsReport?.length||0}</b></p>

    <p><small>Hinweis: Automatisierter Kurz-Check gemäß WCAG 2.1 / BITV 2.1. Für OZG/BFSG wird eine regelmäßige Aktualisierung empfohlen.</small></p>
  </body></html>`;
}

async function main() {
  const outDir = process.env.OUTPUT_DIR || path.join(process.cwd(), "out");
  const summary: ScanSummary = JSON.parse(await fs.readFile(path.join(outDir, "scan.json"), "utf-8"));
  const issues: any[] = JSON.parse(await fs.readFile(path.join(outDir, "issues.json"), "utf-8"));
  let downloadsReport: any[] = [];
  try {
    downloadsReport = JSON.parse(await fs.readFile(path.join(outDir, "downloads_report.json"), "utf-8"));
  } catch {}

  // HTML rendern
  const internalHtml = renderInternalHTML(summary, issues, downloadsReport);
  const publicHtml = renderPublicHTML(summary, issues, downloadsReport);

  // HTML speichern
  await fs.writeFile(path.join(outDir, "report_internal.html"), internalHtml, "utf-8");
  await fs.writeFile(path.join(outDir, "report_public.html"), publicHtml, "utf-8");

  // PDF drucken
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1080, height: 1440 });

  await page.setContent(internalHtml, { waitUntil: "domcontentloaded" });
  await page.pdf({ path: path.join(outDir, "report_internal.pdf"), format: "A4", margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" } });

  await page.setContent(publicHtml, { waitUntil: "domcontentloaded" });
  await page.pdf({ path: path.join(outDir, "report_public.pdf"), format: "A4", margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" } });

  await browser.close();

  console.log("✅ Reports erzeugt (HTML+PDF) in", outDir);
}

main().catch((e)=>{ console.error("Report-Build fehlgeschlagen:", e); process.exit(1); });
