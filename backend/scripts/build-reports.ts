/**
 * Erzeugt HTML+PDF (intern/öffentlich) und eine maschinenlesbare Erklärung (public_statement.json)
 * aus den Crawl-Artefakten in backend/out/. Öffentliche Erklärung entspricht inhaltlich dem EU-Muster
 * (Richtlinie 2016/2102, Durchführungsbeschluss 2018/1523). Siehe Pflichtabschnitte: Vereinbarkeit,
 * nicht barrierefreie Inhalte (+Begründungen), Erstellung/Prüfmethode, Feedback/Kontakt,
 * Durchsetzungsverfahren.  // Quellenhinweis im README empfohlen.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function fromTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of tags || []) {
    const m = t.match(/^wcag(\d)(\d)(\d)$/i);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

function enrich(v:any, mapping:Record<string,any>, bitvMap:any, enMap:any){
  const m = mapping[v.id] || {};
  const hasExplicit = Boolean(mapping[v.id]);
  let wcag: string[] = v.wcagRefs || m.wcag || [];
  if (!wcag.length) wcag = fromTags(v.tags);
  let bitv: string[] = v.bitvRefs || m.bitv || [];
  let en: string[] = v.en301549Refs || m.en301549 || [];
  if (!bitv.length) bitv = wcag.map((w:string)=>bitvMap[w] || (bitvMap._prefix ? bitvMap._prefix + w : undefined)).filter(Boolean);
  if (!en.length) en = wcag.map((w:string)=>enMap[w] || (enMap._prefix ? enMap._prefix + w : undefined)).filter(Boolean);
  v.wcagRefs = wcag; v.bitvRefs = bitv; v.en301549Refs = en;
  if (m.legalContext) v.legalContext = m.legalContext;
  if (!hasExplicit && (wcag.length || bitv.length || en.length)) v.mapped = true;
}

type ScanSummary = {
  startUrl: string;
  date: string;
  pagesCrawled: number;
  downloadsFound: number;
  score: number;
  totals: { violations: number; incomplete: number };
};

type Profile = {
  organisationName?: string;
  websiteOwner?: string;
  jurisdiction?: { country?: string; federalState?: string };
  contact?: { email?: string; phone?: string; url?: string; responseTimeDays?: number };
  enforcement?: { name?: string; url?: string; email?: string };
  legal?: { standard?: string; method?: string; language?: string };
  statement?: {
    updateFrequencyDays?: number;
    disproportionateBurden?: string[]; // Inhalte, die aus Unverhältnismäßigkeit (Art. 5) herausgenommen sind
    outOfScope?: string[];            // Inhalte außerhalb des Geltungsbereichs (z. B. Fremdinhalte)
  };
  manualFindings?: { title: string; description?: string; reason?: string }[];
};

function escapeHtml(s: string) {
  return (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[m]);
}
function cssBase() {
  return `
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px}
  table{border-collapse:collapse;width:100%;margin:12px 0 24px}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:top}
  th{background:#f6f7f9}
  .badge{display:inline-block;padding:6px 10px;border-radius:8px;color:#fff;font-weight:700}
  .green{background:#1f8a3b}.yellow{background:#b58900}.red{background:#d11a2a}
  small{color:#555}
  h1,h2{margin-top:22px}
  `;
}
function domainFromUrl(u: string) { try { return new URL(u).origin; } catch { return u; } }
function badge(level: "green"|"yellow"|"red") {
  const cls = level === "green" ? "green" : level === "yellow" ? "yellow" : "red";
  const txt = level === "green" ? "GRÜN" : level === "yellow" ? "GELB" : "ROT";
  return `<span class="badge ${cls}">${txt}</span>`;
}
function vereinbarkeitsStatus(violations: number, score: number) {
  if (violations === 0) return { label: "vollständig vereinbar", level: "green", code: "full" };
  if (score >= 70) return { label: "teilweise vereinbar", level: "yellow", code: "partial" };
  return { label: "nicht vereinbar", level: "red", code: "non" };
}
function deriveTopFindings(issues: any[], limit = 8) {
  const map = new Map<string, { help: string; wcag: string[]; count: number }>();
  for (const v of issues) {
    const key = v.id || v.help || "unbekannt";
    const entry = map.get(key) || { help: v.help || v.id || "unbekannt", wcag: v.wcagRefs || [], count: 0 };
    entry.count += 1;
    if (Array.isArray(v.wcagRefs) && v.wcagRefs.length) entry.wcag = v.wcagRefs;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

function renderInternalHTML(summary: ScanSummary, issues: any[], downloadsReport: any[]) {
  const rows = issues.slice(0, 300).map((v: any) => {
    const targets = (v.nodes || []).slice(0, 3).map((n: any) => `<code>${escapeHtml((n.target?.[0]||"").toString())}</code>`).join("<br/>");
    const wcag = v.wcagRefs && v.wcagRefs.length ? v.wcagRefs.join(", ") : "—";
    const bitv = v.bitvRefs && v.bitvRefs.length ? v.bitvRefs.join(", ") : "—";
    const en = v.en301549Refs && v.en301549Refs.length ? v.en301549Refs.join(", ") : "—";
    const ruleId = escapeHtml(v.id||"");
    const label = v.mapped ? `${ruleId} <small>(mapped)</small>` : ruleId;
    return `<tr>
      <td><b>${label}</b><br/><small>${escapeHtml(v.help||"")}</small></td>
      <td>${escapeHtml(v.impact||"n/a")}</td>
      <td><small>WCAG: ${escapeHtml(wcag)}<br/>BITV: ${escapeHtml(bitv)}<br/>EN: ${escapeHtml(en)}</small></td>
      <td>${targets}</td>
    </tr>`;
  }).join("");

  const dlRows = (downloadsReport||[]).map((d: any) => {
    const checks = (d.checks||[]).map((c:any)=>`<li>${escapeHtml(c.name)}: ${c.passed?"✔︎":"✘"}${c.details?` – ${escapeHtml(c.details)}`:""}</li>`).join("");
    return `<tr>
      <td><a href="${escapeHtml(d.url)}">${escapeHtml(d.url)}</a></td>
      <td>${escapeHtml(String(d.type).toUpperCase())}</td>
      <td>${d.ok?"OK":"<b>Nicht bestanden</b>"}</td>
      <td><ul>${checks}</ul>${d.note?`<small>${escapeHtml(d.note)}</small>`:""}</td>
    </tr>`;
  }).join("");

  return `<!doctype html><html lang="de"><head>
    <meta charset="utf-8"/>
    <title>Interner Barrierefreiheitsbericht</title>
    <style>${cssBase()}</style>
  </head><body>
    <h1>Interner Barrierefreiheitsbericht</h1>
    <p><b>Geltungsbereich:</b> ${escapeHtml(domainFromUrl(summary.startUrl))}<br/>
       <b>Datum:</b> ${escapeHtml(summary.date)}<br/>
       <b>Seiten:</b> ${summary.pagesCrawled} • <b>Downloads:</b> ${summary.downloadsFound}</p>
    <p><b>Gesamt:</b> ${badge(vereinbarkeitsStatus(summary.totals.violations, summary.score).level as any)}
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

    <p><small>Hinweis: Automatisierte Prüfung (axe-core, heuristische Datei-Checks). Für Rechtsverbindlichkeit ggf. ergänzende manuelle Prüfungen.</small></p>
  </body></html>`;
}

function renderPublicHTML(summary: ScanSummary, issues: any[], downloadsReport: any[], profile: Profile) {
  const status = vereinbarkeitsStatus(summary.totals.violations, summary.score);
  const top = deriveTopFindings(issues, 8);
  const today = new Date().toISOString().slice(0,10);

  const topList = top.length
    ? top.map((v) => `<li>${escapeHtml(v.help)} (WCAG: ${escapeHtml((v.wcag && v.wcag.length ? v.wcag.join(', ') : '—'))})</li>`).join("")
    : `<li><small>Keine prioritären Befunde festgestellt.</small></li>`;

  const manual = (profile.manualFindings || []).map((m) =>
    `<li><b>${escapeHtml(m.title)}</b>${m.reason?` – <i>${escapeHtml(m.reason)}</i>`:""}${m.description?`<br/><small>${escapeHtml(m.description)}</small>`:""}</li>`
  ).join("");

  const dispro = (profile.statement?.disproportionateBurden||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join("");
  const oos   = (profile.statement?.outOfScope||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join("");

  return `<!doctype html><html lang="${escapeHtml(profile.legal?.language || "de-DE")}"><head>
    <meta charset="utf-8"/>
    <title>Erklärung zur Barrierefreiheit</title>
    <style>${cssBase()}</style>
  </head><body>
    <h1>Erklärung zur Barrierefreiheit</h1>
    <p><b>Geltungsbereich:</b> ${escapeHtml(domainFromUrl(summary.startUrl))}${profile.websiteOwner?` – ${escapeHtml(profile.websiteOwner)}`:""}</p>

    <h2>1. Stand der Vereinbarkeit</h2>
    <p>Diese Website ist ${badge(status.level as any)} <b>${escapeHtml(status.label)}</b> mit den Anforderungen der
       ${escapeHtml(profile.legal?.standard || "WCAG 2.1 / EN 301 549 / BITV 2.0")}.</p>

    <h2>2. Nicht barrierefreie Inhalte</h2>
    <p>Automatisiert ermittelte Schwerpunkte:</p>
    <ul>${topList}</ul>
    ${manual ? `<p>Zusätzliche Feststellungen:</p><ul>${manual}</ul>` : ""}

    ${dispro ? `<h3>2.1 Inhalte, deren Barrierefreiheit eine unverhältnismäßige Belastung darstellt</h3><ul>${dispro}</ul>` : ""}
    ${oos ? `<h3>2.2 Inhalte, die nicht in den Anwendungsbereich der Richtlinie fallen</h3><ul>${oos}</ul>` : ""}

    <h2>3. Erstellung dieser Erklärung</h2>
    <p>Erstellt am ${escapeHtml(today)}. Grundlage: ${escapeHtml(profile.legal?.method || "automatisierte Selbstbewertung")}.
       Letzte technische Überprüfung: ${escapeHtml(summary.date)}.
       Aktualisierung geplant alle ${escapeHtml(String(profile.statement?.updateFrequencyDays || 365))} Tage.</p>

    <h2>4. Feedback und Kontakt</h2>
    <ul>
      ${profile.contact?.email ? `<li>E-Mail: <a href="mailto:${escapeHtml(profile.contact.email)}">${escapeHtml(profile.contact.email)}</a></li>` : ""}
      ${profile.contact?.phone ? `<li>Telefon: ${escapeHtml(profile.contact.phone)}</li>` : ""}
      ${profile.contact?.url ? `<li>Kontaktformular/Seite: <a href="${escapeHtml(profile.contact.url)}">${escapeHtml(profile.contact.url)}</a></li>` : ""}
    </ul>
    ${profile.contact?.responseTimeDays ? `<p>Antwortzeit: in der Regel innerhalb von ${escapeHtml(String(profile.contact.responseTimeDays))} Tagen.</p>` : ""}

    <h2>5. Durchsetzungsverfahren</h2>
    <p>Wenn Sie keine zufriedenstellende Antwort erhalten, können Sie sich an die zuständige Durchsetzungsstelle wenden:</p>
    <ul>
      ${profile.enforcement?.name ? `<li>${escapeHtml(profile.enforcement.name)}</li>` : ""}
      ${profile.enforcement?.url ? `<li>Website: <a href="${escapeHtml(profile.enforcement.url)}">${escapeHtml(profile.enforcement.url)}</a></li>` : ""}
      ${profile.enforcement?.email ? `<li>E-Mail: <a href="mailto:${escapeHtml(profile.enforcement.email)}">${escapeHtml(profile.enforcement.email)}</a></li>` : ""}
    </ul>

    <h2>6. Hinweise zu Dokumenten/Downloads</h2>
    <p>Prüfbare Dateien insgesamt: <b>${downloadsReport?.length || 0}</b>.
       Legacy-Formate (DOC/PPT) werden als nicht automatisch prüfbar gekennzeichnet und sukzessive ersetzt.</p>

    <p><small>Diese Erklärung wird regelmäßig aktualisiert.</small></p>
  </body></html>`;
}

/** Maschinenlesbare Erklärung (vereinfachtes JSON nach EU-Musterempfehlung) */
function buildStatementJSON(summary: ScanSummary, issues: any[], profile: Profile) {
  const status = vereinbarkeitsStatus(summary.totals.violations, summary.score);
  const top = deriveTopFindings(issues, 8);
  const preparedOn = new Date().toISOString().slice(0,10);

  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "name": "Erklärung zur Barrierefreiheit",
    "inLanguage": profile.legal?.language || "de-DE",
    "about": domainFromUrl(summary.startUrl),
    "dateCreated": preparedOn,
    "dateModified": summary.date,
    "accessibilitySummary": {
      "conformanceStatus": status.code, // full | partial | non
      "standard": profile.legal?.standard || "WCAG 2.1 / EN 301 549 / BITV 2.0",
      "method": profile.legal?.method || "automatisierte Selbstbewertung",
      "topFindings": top.map(t => ({ text: t.help, wcag: t.wcag }))
    },
    "provider": {
      "name": profile.organisationName || profile.websiteOwner || ""
    },
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "feedback",
      "email": profile.contact?.email || "",
      "telephone": profile.contact?.phone || "",
      "url": profile.contact?.url || ""
    },
    "isAccessibleForFree": true,
    "jurisdiction": profile.jurisdiction || {}
  };
}

async function main() {
  const outDir = process.env.OUTPUT_DIR || path.join(process.cwd(), "out");
  const summary: ScanSummary = JSON.parse(await fs.readFile(path.join(outDir, "scan.json"), "utf-8"));
  const issues: any[] = JSON.parse(await fs.readFile(path.join(outDir, "issues.json"), "utf-8"));
  let downloadsReport: any[] = []; try { downloadsReport = JSON.parse(await fs.readFile(path.join(outDir, "downloads_report.json"), "utf-8")); } catch {}

  try {
    const mapArr = JSON.parse(await fs.readFile(new URL('../config/rules_mapping.json', import.meta.url), 'utf-8'));
    const bitvMap = JSON.parse(await fs.readFile(new URL('../config/norm_maps/bitv.json', import.meta.url), 'utf-8'));
    const enMap = JSON.parse(await fs.readFile(new URL('../config/norm_maps/en.json', import.meta.url), 'utf-8'));
    const byId: Record<string, any> = {};
    for (const m of mapArr) byId[m.axeRuleId] = m;
    for (const v of issues) {
      if (!v.wcagRefs?.length || !v.bitvRefs?.length || !v.en301549Refs?.length) {
        enrich(v, byId, bitvMap, enMap);
      }
    }
  } catch {}

  // Profil laden
  let profile: Profile = {};
  try { profile = JSON.parse(await fs.readFile(path.join(process.cwd(), "config", "public_statement.profile.json"), "utf-8")); } catch {}

  // HTML bauen
  const internalHtml = renderInternalHTML(summary, issues, downloadsReport);
  const publicHtml = renderPublicHTML(summary, issues, downloadsReport, profile);

  // HTML speichern
  await fs.writeFile(path.join(outDir, "report_internal.html"), internalHtml, "utf-8");
  await fs.writeFile(path.join(outDir, "report_public.html"), publicHtml, "utf-8");

  // JSON-Erklärung speichern (maschinenlesbar)
  const statementJson = buildStatementJSON(summary, issues, profile);
  await fs.writeFile(path.join(outDir, "public_statement.json"), JSON.stringify(statementJson, null, 2), "utf-8");

  // PDF drucken
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1080, height: 1440 });

  await page.setContent(internalHtml, { waitUntil: "domcontentloaded" });
  await page.pdf({ path: path.join(outDir, "report_internal.pdf"), format: "A4", margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" } });

  await page.setContent(publicHtml, { waitUntil: "domcontentloaded" });
  await page.pdf({ path: path.join(outDir, "report_public.pdf"), format: "A4", margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" } });

  await browser.close();
  console.log("✅ Reports + maschinenlesbare Erklärung erzeugt.");
}

main().catch((e)=>{ console.error("Report-Build fehlgeschlagen:", e); process.exit(1); });
