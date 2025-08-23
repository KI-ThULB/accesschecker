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
import { contentTypeToLabel } from "./lib/mime.js";
import { loadOmbudsConfig, resolveJurisdiction, getEntry } from "./lib/ombuds.js";
import { pathToFileURL } from "node:url";

type ScanSummary = {
  startUrl: string;
  date: string;
  pagesCrawled: number;
  downloadsFound: number;
  score: { overall: number; bySeverity: { critical: number; serious: number; moderate: number; minor: number } };
  totals: { violations: number; incomplete: number };
  jurisdiction?: string;
};

type Profile = {
  organisationName?: string;
  websiteOwner?: string;
  jurisdiction?: { country?: string; federalState?: string };
  contact?: { email?: string; phone?: string; url?: string; responseTimeDays?: number };
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
  const map = new Map<string, { id: string; text: string; wcag: string[]; count: number }>();
  for (const v of issues) {
    const key = v.id || v.summary || 'unbekannt';
    const entry = map.get(key) || { id: v.id || key, text: v.summary || key, wcag: v.norms?.wcag || [], count: 0 };
    entry.count += 1;
    if (Array.isArray(v.norms?.wcag) && v.norms.wcag.length) entry.wcag = v.norms.wcag;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

function renderInternalHTML(summary: ScanSummary, issues: any[], downloadsReport: any[], dynamic: any[], landmarks?: any) {
  const regular = issues.filter((v: any) => v.module !== 'semantics-landmarks');
  const lmIssues = issues.filter((v: any) => v.module === 'semantics-landmarks');
  const rows = regular.slice(0, 300).map((v: any) => {
    const targets = (v.selectors || []).slice(0, 3).map((sel: string) => `<code>${escapeHtml(sel)}</code><br/><small>${escapeHtml(v.pageUrl || '')}</small>`).join("<br/>");
    const wcag = (v.norms?.wcag || []).join(", "); const bitv = (v.norms?.bitv || []).join(", "); const en = (v.norms?.en301549 || []).join(", ");
    return `<tr>
      <td><b>${escapeHtml(v.id||"")}</b><br/><small>${escapeHtml(v.summary||"")}</small></td>
      <td>${escapeHtml(v.severity||"n/a")}</td>
      <td><small>WCAG: ${escapeHtml(wcag)}<br/>BITV: ${escapeHtml(bitv)}<br/>EN: ${escapeHtml(en)}</small></td>
      <td>${targets}</td>
    </tr>`;
  }).join("");

  const lmRows = lmIssues.map((v: any) => {
    const targets = (v.selectors || []).slice(0, 3).map((sel: string) => `<code>${escapeHtml(sel)}</code><br/><small>${escapeHtml(v.pageUrl || '')}</small>`).join("<br/>");
    const wcag = (v.norms?.wcag || []).join(", ");
    return `<tr><td><b>${escapeHtml(v.id||"")}</b><br/><small>${escapeHtml(v.summary||"")}</small></td><td>${escapeHtml(v.severity||"n/a")}</td><td><small>WCAG: ${escapeHtml(wcag)}</small></td><td>${targets}</td></tr>`;
  }).join('');

  const typeCounts: Record<string, number> = {};
  for (const d of downloadsReport || []) {
    const label = contentTypeToLabel(d.contentType, d.url);
    d.__label = label;
    typeCounts[label] = (typeCounts[label] || 0) + 1;
  }
  const typeSummary = Object.entries(typeCounts).map(([t, c]) => `${t}: ${c}`).join(', ');

  const dlRows = (downloadsReport || []).map((d: any) => {
    const status = d.status === 'skipped' ? 'Übersprungen' : (d.checks && d.checks.length ? 'Fehler' : 'OK');
    const checks = (d.checks || []).join(', ');
    const name = d.filename || d.url;
    return `<tr>
      <td><a href="${escapeHtml(d.url)}">${escapeHtml(name)}</a></td>
      <td>${escapeHtml(d.__label)}</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(checks)}</td>
    </tr>`;
  }).join('');

  return `<!doctype html><html lang="de"><head>
    <meta charset="utf-8"/>
    <title>Interner Barrierefreiheitsbericht</title>
    <style>${cssBase()}</style>
  </head><body>
    <h1>Interner Barrierefreiheitsbericht</h1>
    <p><b>Geltungsbereich:</b> ${escapeHtml(domainFromUrl(summary.startUrl))}<br/>
       <b>Datum:</b> ${escapeHtml(summary.date)}<br/>
       <b>Seiten:</b> ${summary.pagesCrawled} • <b>Downloads:</b> ${summary.downloadsFound}${typeSummary?` (${escapeHtml(typeSummary)})`:''}</p>
    <p><b>Gesamt:</b> ${badge(vereinbarkeitsStatus(summary.totals.violations, summary.score.overall).level as any)}
      &nbsp;Score: ${summary.score.overall}/100 • Verstöße: ${summary.totals.violations} • Warnungen: ${summary.totals.incomplete}
    </p>

    <h2>Details (axe-core mit Normbezug)</h2>
    <table>
      <thead><tr><th>Regel</th><th>Schwere</th><th>Normbezug</th><th>Beispiele</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4"><small>Keine Verstöße ermittelt.</small></td></tr>'}</tbody>
    </table>

    ${landmarks ? `<h2>Struktur &amp; Landmarken</h2><p>Abdeckung: ${escapeHtml(String(landmarks.metrics?.coverage || 0))}%</p><table><thead><tr><th>Regel</th><th>Schwere</th><th>Normbezug</th><th>Beispiele</th></tr></thead><tbody>${lmRows || '<tr><td colspan="4"><small>Keine Befunde.</small></td></tr>'}</tbody></table>` : ''}

    <h2>Prüfung von Downloads</h2>
    <table>
      <thead><tr><th>Datei</th><th>Typ</th><th>Status</th><th>Checks</th></tr></thead>
      <tbody>${dlRows || '<tr><td colspan="4"><small>Keine prüfbaren Downloads.</small></td></tr>'}</tbody>
    </table>

    <h2>Tastatur &amp; Fokus</h2>
    <table>
      <thead><tr><th>Element</th><th>Regel</th><th>Contrast</th><th>AreaRatio</th><th>Screenshot</th></tr></thead>
      <tbody>${(dynamic||[]).map((d:any)=>`<tr><td><code>${escapeHtml(d.selector||'')}</code></td><td>${escapeHtml(d.rule||'')}</td><td>${d.indicatorContrast?escapeHtml(d.indicatorContrast.toFixed(2)):'-'}</td><td>${d.indicatorAreaRatio?escapeHtml(d.indicatorAreaRatio.toFixed(3)):'-'}</td><td>${d.screenshot?`<a href="${escapeHtml(d.screenshot)}">Bild</a>`:''}</td></tr>`).join('') || '<tr><td colspan="5"><small>Keine Tastaturinteraktionen protokolliert.</small></td></tr>'}</tbody>
    </table>

    <p><small>Hinweis: Automatisierte Prüfung (axe-core, heuristische Datei-Checks). Für Rechtsverbindlichkeit ggf. ergänzende manuelle Prüfungen.</small></p>
  </body></html>`;
}

function renderPublicHTML(summary: ScanSummary, issues: any[], downloadsReport: any[], profile: Profile, authority: any, enforcementDataStatus?: string, landmarks?: any) {
  let status = vereinbarkeitsStatus(summary.totals.violations, summary.score.overall);
  if (summary.totals.violations === 0 && !(profile.manualFindings && profile.manualFindings.length)) {
    status = { ...status, code: "unknown" };
  }
  const nonLandmarks = issues.filter((v: any) => v.module !== 'semantics-landmarks');
  const formIssues = nonLandmarks.filter((v: any) => (v.id || '').startsWith('forms:'));
  let top = formIssues.length ? deriveTopFindings(formIssues, 3) : deriveTopFindings(nonLandmarks, 8);
  const focusIssues = nonLandmarks.filter((v: any) => ['keyboard:outline-suppressed','keyboard:focus-indicator-weak'].includes(v.id));
  if (focusIssues.length && !top.some((t:any)=>t.id==='keyboard:focus-indicator-weak')) {
    top.unshift({ id: 'keyboard:focus-indicator-weak', text: 'Fokus-Indikator unzureichend', wcag: ['2.4.7'], count: focusIssues.length });
  }
  const dlIssues = nonLandmarks.filter((v: any) => /^(pdf:|office:|csv:)/.test(v.id || ''));
  const dlTop = deriveTopFindings(dlIssues, 3);
  const today = new Date().toISOString().slice(0,10);

  const plainMap: Record<string, string> = {
    "link-name": "Links haben kein erkennbares Ziel",
    "image-alt": "Bilder ohne Alternativtext",
    "color-contrast": "Texte haben zu wenig Farbkontrast",
    "html-has-lang": "Seite nennt keine Sprache",
    "document-title": "Seite hat keinen Titel",
    "forms:missing-label": "Formularfeld ohne Beschriftung",
    "forms:multiple-labels": "Formularfeld mit mehreren Beschriftungen",
    "forms:error-not-associated": "Fehlermeldung nicht mit Feld verknüpft",
    "forms:required-not-indicated": "Pflichtfeld nicht gekennzeichnet",
    "forms:missing-fieldset-legend": "Gruppe ohne fieldset/legend",
    "forms:autocomplete-missing-or-wrong": "Autocomplete oder Typ fehlt/falsch",
    "pdf:untagged": "PDF ohne Tags",
    "pdf:missing-lang": "PDF ohne Sprache",
    "pdf:missing-title": "PDF ohne Titel",
    "office:missing-core-properties": "Office-Dokument ohne Metadaten",
    "office:alttext-review": "Office-Bilder: Alt-Texte prüfen",
    "csv:encoding": "Datei nicht UTF-8 kodiert",
    "csv:line-endings": "Uneinheitliche Zeilenenden",
    "csv:delimiter-mismatch": "Inkonsistente Trennzeichen",
    "keyboard:focus-indicator-weak": "Fokus-Indikator unzureichend",
    "keyboard:outline-suppressed": "Fokus-Indikator unterdrückt"
  };

  const topListBase = top.length
    ? top.map((v) => `<li>${escapeHtml(plainMap[v.id] || v.text)}${v.wcag.length?` (WCAG: ${escapeHtml(v.wcag.join(', '))})`:''}</li>`).join("")
    : `<li><small>Keine prioritären Befunde festgestellt.</small></li>`;

  let landmarkBullet = '';
  if (landmarks && (landmarks.findings || []).length) {
    const cov = Math.round(landmarks.metrics?.coverage || 0);
    const miss = (landmarks.findings || []).some((f: any) => f.id === 'landmarks:missing-main');
    landmarkBullet = `<li>${escapeHtml(`Landmark-Abdeckung ${cov}%${miss ? ' / fehlendes <main>' : ''}`)}</li>`;
  }
  const topList = landmarkBullet + topListBase;

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
      <li>${escapeHtml(authority.label)}</li>
      ${authority.website && !authority.website.includes('TODO') ? `<li>Website: <a href="${escapeHtml(authority.website)}">${escapeHtml(authority.website)}</a></li>` : ''}
      ${authority.email && !authority.email.includes('TODO') ? `<li>E-Mail: <a href="mailto:${escapeHtml(authority.email)}">${escapeHtml(authority.email)}</a></li>` : ''}
      ${authority.phone && !authority.phone.includes('TODO') ? `<li>Telefon: ${escapeHtml(authority.phone)}</li>` : ''}
      ${authority.postalAddress && !authority.postalAddress.includes('TODO') ? `<li>Adresse: ${escapeHtml(authority.postalAddress)}</li>` : ''}
    </ul>
    ${enforcementDataStatus === 'incomplete' ? `<p>Die Kontaktdaten der zuständigen Durchsetzungsstelle werden kurzfristig ergänzt. Bis dahin wenden Sie sich bitte an die bundesweite Schlichtungsstelle.</p>` : ''}

    <h2>6. Hinweise zu Dokumenten/Downloads</h2>
    <p>Prüfbare Dateien insgesamt: <b>${downloadsReport?.length || 0}</b>.</p>
    ${dlTop.length ? `<p>Häufige Probleme:</p><ul>${dlTop.map(v => `<li>${escapeHtml(plainMap[v.id] || v.text)}</li>`).join('')}</ul>` : ''}
    <p><small>Legacy-Formate (DOC/PPT) werden als nicht automatisch prüfbar gekennzeichnet und sukzessive ersetzt.</small></p>

    <p><small>Diese Erklärung wird regelmäßig aktualisiert.</small></p>
  </body></html>`;
}

/** Maschinenlesbare Erklärung (vereinfachtes JSON nach EU-Musterempfehlung) */
function buildStatementJSON(summary: ScanSummary, issues: any[], profile: Profile, authority: any, enforcementDataStatus?: string, landmarks?: any) {
  let status = vereinbarkeitsStatus(summary.totals.violations, summary.score.overall);
  if (summary.totals.violations === 0 && !(profile.manualFindings && profile.manualFindings.length)) {
    status = { ...status, code: "unknown" };
  }
  const nonLandmarks = issues.filter((v: any) => v.module !== 'semantics-landmarks');
  const formIssues = nonLandmarks.filter((v: any) => (v.id || '').startsWith('forms:'));
  let top = formIssues.length ? deriveTopFindings(formIssues, 3) : deriveTopFindings(nonLandmarks, 8);
  const focusIssues = nonLandmarks.filter((v: any) => ['keyboard:outline-suppressed','keyboard:focus-indicator-weak'].includes(v.id));
  if (focusIssues.length && !top.some((t:any)=>t.id==='keyboard:focus-indicator-weak')) {
    top.unshift({ id: 'keyboard:focus-indicator-weak', text: 'Fokus-Indikator unzureichend', wcag: ['2.4.7'], count: focusIssues.length });
  }
  const preparedOn = new Date().toISOString().slice(0,10);
  const plainMap: Record<string, string> = {
    "link-name": "Links haben kein erkennbares Ziel",
    "image-alt": "Bilder ohne Alternativtext",
    "color-contrast": "Texte haben zu wenig Farbkontrast",
    "html-has-lang": "Seite nennt keine Sprache",
    "document-title": "Seite hat keinen Titel",
    "forms:missing-label": "Formularfeld ohne Beschriftung",
    "forms:multiple-labels": "Formularfeld mit mehreren Beschriftungen",
    "forms:error-not-associated": "Fehlermeldung nicht mit Feld verknüpft",
    "forms:required-not-indicated": "Pflichtfeld nicht gekennzeichnet",
    "forms:missing-fieldset-legend": "Gruppe ohne fieldset/legend",
    "forms:autocomplete-missing-or-wrong": "Autocomplete oder Typ fehlt/falsch",
    "pdf:untagged": "PDF ohne Tags",
    "pdf:missing-lang": "PDF ohne Sprache",
    "pdf:missing-title": "PDF ohne Titel",
    "office:missing-core-properties": "Office-Dokument ohne Metadaten",
    "office:alttext-review": "Office-Bilder: Alt-Texte prüfen",
    "csv:encoding": "Datei nicht UTF-8 kodiert",
    "csv:line-endings": "Uneinheitliche Zeilenenden",
    "csv:delimiter-mismatch": "Inkonsistente Trennzeichen",
    "keyboard:focus-indicator-weak": "Fokus-Indikator unzureichend",
    "keyboard:outline-suppressed": "Fokus-Indikator unterdrückt"
  };

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
      "topFindings": (() => {
        const arr = top.map(t => ({ id: t.id, text: plainMap[t.id] || t.text, wcag: t.wcag, count: t.count }));
        if (landmarks && (landmarks.findings || []).length) {
          const cov = Math.round(landmarks.metrics?.coverage || 0);
          const miss = (landmarks.findings || []).some((f: any) => f.id === 'landmarks:missing-main');
          arr.unshift({ id: 'landmarks:summary', text: `Landmark-Abdeckung ${cov}%${miss ? ' / fehlendes <main>' : ''}`, wcag: ['1.3.1'], count: (landmarks.findings || []).length || 1 });
        }
        return arr;
      })()
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
    "jurisdiction": profile.jurisdiction || {},
    "enforcement": {
      "jurisdiction": authority.jurisdiction,
      "label": authority.label,
      "website": authority.website,
      "email": authority.email,
      "phone": authority.phone,
      "postalAddress": authority.postalAddress,
      "legalBasis": authority.legalBasis || []
    },
    ...(enforcementDataStatus ? { enforcementDataStatus } : {})
  };
}

export async function main() {
  const outDir = process.env.OUTPUT_DIR || path.join(process.cwd(), "out");
  const results = JSON.parse(await fs.readFile(path.join(outDir, "results.json"), "utf-8"));
  let downloadsReport: any[] = [];
  try {
    const idx = results.modules?.downloads?.artifacts?.index || 'downloads_index.json';
    downloadsReport = JSON.parse(await fs.readFile(path.join(outDir, path.basename(idx)), 'utf-8'));
  } catch {}
  const summary: ScanSummary = {
    startUrl: results.meta?.target || '',
    date: results.meta?.finishedAt || '',
    pagesCrawled: results.pages?.length || 0,
    downloadsFound: downloadsReport.length,
    score: results.score || { overall: 0, bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 } },
    totals: { violations: results.issues?.length || 0, incomplete: 0 },
    jurisdiction: results.meta?.jurisdiction
  };
  const issues: any[] = results.issues || [];
  let dynamicInteractions: any[] = [];
  try {
    dynamicInteractions = JSON.parse(await fs.readFile(path.join(outDir, "keyboard_trace.json"), "utf-8"));
  } catch {}

  // Profil laden
  let profile: Profile = {};
  try { profile = JSON.parse(await fs.readFile(path.join(process.cwd(), "config", "public_statement.profile.json"), "utf-8")); } catch {}
  let publicConfig: any = {};
  try { publicConfig = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config', 'scan.defaults.json'), 'utf-8')); } catch {}
  if (summary.jurisdiction) publicConfig.jurisdiction = summary.jurisdiction;

  const ombuds = await loadOmbudsConfig();
  const j = resolveJurisdiction({ configOverride: publicConfig?.jurisdiction, fromDomain: summary.startUrl });
  const authority = getEntry(j);
  let enforcementDataStatus: string | undefined;
  if (authority.jurisdiction !== j) enforcementDataStatus = 'fallback';
  const hasTodo = ['website','email','phone','postalAddress'].some((k) => (authority as any)[k]?.includes('TODO'));
  if (hasTodo) enforcementDataStatus = 'incomplete';

  const landmarks = results.modules?.['semantics-landmarks'];
  // HTML bauen
  const internalHtml = renderInternalHTML(summary, issues, downloadsReport, dynamicInteractions, landmarks);
  const publicHtml = renderPublicHTML(summary, issues, downloadsReport, profile, authority, enforcementDataStatus, landmarks);

  // HTML speichern
  await fs.writeFile(path.join(outDir, "report_internal.html"), internalHtml, "utf-8");
  await fs.writeFile(path.join(outDir, "report_public.html"), publicHtml, "utf-8");

  // JSON-Erklärung speichern (maschinenlesbar)
  const statementJson = buildStatementJSON(summary, issues, profile, authority, enforcementDataStatus, landmarks);
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e)=>{ console.error("Report-Build fehlgeschlagen:", e); process.exit(1); });
}
