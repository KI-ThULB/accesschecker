import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import unzipper from "unzipper";

export interface DownloadCheck {
  url: string;
  type: "pdf" | "doc" | "docx" | "ppt" | "pptx" | "csv" | "txt" | "other";
  ok: boolean;
  checks: { name: string; passed: boolean; details?: string }[];
  note?: string;
  needsManualReview?: boolean;
  imagesWithoutAlt?: boolean;
  hasHeaderRow?: boolean;
}

function extType(u: string): DownloadCheck["type"] {
  const m = u.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  const ext = m ? m[1] : "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (ext === "doc") return "doc";
  if (ext === "ppt") return "ppt";
  if (ext === "csv") return "csv";
  if (ext === "txt") return "txt";
  return "other";
}

function limitBuffer(buf: Buffer, maxBytes = 5 * 1024 * 1024) {
  // HINWEIS: große Downloads werden auf 5 MB begrenzt
  return buf.length > maxBytes ? buf.slice(0, maxBytes) : buf;
}

export async function checkDownloads(urls: string[]): Promise<DownloadCheck[]> {
  const out: DownloadCheck[] = [];
  for (const url of urls) {
    const t = extType(url);

    // Legacy-Binärformate: nicht automatisch prüfbar (DOC/PPT)
    if (t === "doc" || t === "ppt") {
      out.push({
        url, type: t, ok: false,
        // HINWEIS: Hinweis zur Konvertierung ausgeben
        note: "Altes Binary-Format (DOC/PPT) – automatische BITV/WCAG-Prüfung nicht möglich. Bitte in ein modernes, barrierefrei prüfbares Format (DOCX/PPTX oder PDF/UA) konvertieren.",
        checks: [{ name: "legacy-format", passed: false, details: "Nicht automatisch prüfbar" }],
      });
      continue;
    }

    try {
      // HINWEIS: Download mit 15s Timeout abrufen
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { redirect: "follow", signal: controller.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const buf = limitBuffer(raw);

      if (t === "pdf") {
        const { ok, checks, needsManualReview, imagesWithoutAlt } = analyzePdf(buf);
        out.push({ url, type: t, ok, checks, needsManualReview, imagesWithoutAlt });
        continue;
      }
      if (t === "docx" || t === "pptx") {
        const { ok, checks } = await analyzeOOXML(buf, t);
        out.push({ url, type: t, ok, checks });
        continue;
      }
      if (t === "csv" || t === "txt") {
        const { ok, checks, hasHeaderRow } = analyzeCsvTxt(buf);
        out.push({ url, type: t, ok, checks, hasHeaderRow });
        continue;
      }

      out.push({
        url, type: "other", ok: false,
        checks: [{ name: "unsupported", passed: false, details: "Nicht unterstütztes Format" }],
      });
    } catch (e: any) {
      out.push({ url, type: t, ok: false, checks: [{ name: "download-error", passed: false, details: e?.message || String(e) }] });
    }
  }
  return out;
}

function analyzePdf(buf: Buffer): { ok: boolean; needsManualReview: boolean; imagesWithoutAlt: boolean; checks: { name: string; passed: boolean; details?: string }[] } {
  const head = buf.slice(0, 8).toString("utf-8");
  const txt = buf.toString("latin1"); // robust gegen Binärbytes
  const checks: { name: string; passed: boolean; details?: string }[] = [];
  const hasHeader = head.startsWith("%PDF-");
  const hasStruct = /\/StructTreeRoot/.test(txt);
  const hasMarkInfo = /\/MarkInfo\s*<<?\s*\/Marked\s*true/i.test(txt);
  const hasAnyAlt = /\/Alt\s*\(/.test(txt);
  const hasFonts = /\/Font\s*<</.test(txt);
  const hasOutline = /\/Outlines\s*<</.test(txt);
  const hasTitle = /\/Title\s*\([^)]*\)/.test(txt);
  const imageCount = (txt.match(/\/Subtype\s*\/Image/g) || []).length;
  const altCount = (txt.match(/\/Alt\s*\(/g) || []).length;
  const imagesWithoutAlt = imageCount > altCount;

  checks.push({ name: "pdf-header", passed: hasHeader });
  checks.push({ name: "tagged-structure", passed: hasStruct });
  checks.push({ name: "markinfo-marked", passed: hasMarkInfo });
  checks.push({ name: "alt-texts-present", passed: hasAnyAlt, details: "Heuristik: mindestens ein /Alt gefunden" });
  checks.push({ name: "fonts-embedded", passed: hasFonts });
  checks.push({ name: "outline-present", passed: hasOutline });
  checks.push({ name: "document-title", passed: hasTitle });
  checks.push({ name: "images-have-alt", passed: !imagesWithoutAlt, details: `images:${imageCount} alt:${altCount}` });

  const ok = hasStruct && hasMarkInfo && hasOutline && hasTitle && !imagesWithoutAlt;
  const needsManualReview = !hasOutline;
  return { ok, checks, needsManualReview, imagesWithoutAlt };
}

function analyzeCsvTxt(buf: Buffer): { ok: boolean; hasHeaderRow: boolean; checks: { name: string; passed: boolean; details?: string }[] } {
  const txt = buf.toString('utf-8');
  const firstLine = txt.split(/\r?\n/)[0] || '';
  const sep = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const cells = firstLine.split(sep).map(c => c.trim());
  const headerOk = cells.length > 1 && cells.every(c => /^[A-Za-z0-9 _-]+$/.test(c));
  const checks = [{ name: 'header-row', passed: headerOk }];
  return { ok: headerOk, hasHeaderRow: headerOk, checks };
}

async function analyzeOOXML(buf: Buffer, kind: "docx" | "pptx"): Promise<{ ok: boolean; checks: { name: string; passed: boolean; details?: string }[] }> {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), "oox-"));
  try {
    // entpacken
    const zip = await unzipper.Open.buffer(buf);
    await Promise.all(zip.files.map(async (f: any) => {
      const out = path.join(tmpDir, f.path);
      const dir = path.dirname(out);
      fs.mkdirSync(dir, { recursive: true });
      if (f.type === "Directory") return;
      const rs = f.stream();
      const ws = fs.createWriteStream(out);
      await new Promise<void>((res, rej) => { rs.pipe(ws).on("finish", () => res()).on("error", rej); });
    }));

    const checks: { name: string; passed: boolean; details?: string }[] = [];

    if (kind === "docx") {
      const docXml = path.join(tmpDir, "word/document.xml");
      const stylesXml = path.join(tmpDir, "word/styles.xml");
      const hasDoc = fs.existsSync(docXml);
      const hasStyles = fs.existsSync(stylesXml);
      const doc = hasDoc ? fs.readFileSync(docXml, "utf-8") : "";
      const hasHeading = /w:pPr[\s\S]*w:pStyle[^>]*w:val="Heading[1-6]"/i.test(doc) || /w:outlineLvl/i.test(doc);
      const hasAlt = /wp:docPr[^>]*(?:descr|title)="[^"]+"/i.test(doc);
      checks.push({ name: "oox-structure", passed: hasDoc && hasStyles });
      checks.push({ name: "headings-present", passed: hasHeading });
      checks.push({ name: "alt-texts-present", passed: hasAlt });
      const ok = hasHeading && hasAlt;
      return { ok, checks };
    } else {
      const pres = path.join(tmpDir, "ppt/presentation.xml");
      const slide1 = path.join(tmpDir, "ppt/slides/slide1.xml");
      const hasPres = fs.existsSync(pres);
      const slideXml = fs.existsSync(slide1) ? fs.readFileSync(slide1, "utf-8") : "";
      const hasTitlePH = /<p:ph[^>]*type="title"/i.test(slideXml);
      const hasAlt = /<p:cNvPr[^>]*(?:descr|title)="[^"]+"/i.test(slideXml);
      checks.push({ name: "oox-structure", passed: hasPres && fs.existsSync(slide1) });
      checks.push({ name: "title-placeholder", passed: hasTitlePH });
      checks.push({ name: "alt-texts-present", passed: hasAlt });
      const ok = hasTitlePH && hasAlt;
      return { ok, checks };
    }
  } finally {
    // cleanup best-effort
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export { analyzePdf };
