import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { PDFDocument } from "pdf-lib";
import unzipper from "unzipper";

export interface DownloadCheck {
  url: string;
  type: "pdf" | "doc" | "docx" | "ppt" | "pptx" | "other";
  ok: boolean;
  checks: { name: string; passed: boolean; details?: string }[];
  note?: string;
}

function extType(u: string): DownloadCheck["type"] {
  const m = u.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  const e = m ? m[1] : "";
  if (e === "pdf") return "pdf";
  if (e === "doc" || e === "docx") return e as any;
  if (e === "ppt" || e === "pptx") return e as any;
  return "other";
}

export async function checkDownloads(urls: string[]): Promise<DownloadCheck[]> {
  const out: DownloadCheck[] = [];
  for (const url of urls) {
    const t = extType(url);
    try {
      // Legacy-Formate klar kennzeichnen (nicht automatisch prüfbar)
      if (t === "doc" || t === "ppt") {
        out.push({
          url, type: t, ok: false,
          checks: [{ name: "legacy-format", passed: false, details: "Altes Binary-Format (DOC/PPT) – nicht automatisch prüfbar." }],
          note: "Bitte in OOXML (DOCX/PPTX) oder PDF/UA konvertieren und erneut prüfen."
        });
        continue;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());

      if (t === "pdf") {
        const { ok, checks } = analyzePdf(buf);
        out.push({ url, type: t, ok, checks });
        continue;
      }
      if (t === "docx" || t === "pptx") {
        const { ok, checks } = await analyzeOOXML(buf, t);
        out.push({ url, type: t, ok, checks });
        continue;
      }

      out.push({ url, type: "other", ok: false, checks: [{ name: "unsupported", passed: false, details: "Nicht unterstütztes Format" }] });
    } catch (e: any) {
      out.push({ url, type: t, ok: false, checks: [{ name: "download-error", passed: false, details: String(e?.message || e) }] });
    }
  }
  return out;
}

function analyzePdf(buf: Buffer) {
  // Heuristische Checks direkt im Byte-Stream
  const head = buf.slice(0, Math.min(buf.length, 2_000_000)).toString("latin1");
  const hasHeader = head.includes("%PDF-");
  const hasStruct = head.includes("/StructTreeRoot");
  const hasMarked = /\/MarkInfo\s*<</.test(head) && /\/Marked\s*true/.test(head);
  const hasAlt = /\b\/Alt\s*\(/.test(head);
  const hasFonts = /\/Font\s*<</.test(head);

  // Metadaten-Titel
  let hasTitle = false; let title = "";
  try {
    const pdf = PDFDocument.load(buf, { ignoreEncryption: true });
    // pdf-lib getTitle() ist async; nutzen wir simple XMP/Info-Scan zusätzlich:
    const xmpTitle = head.match(/<dc:title>.*?<rdf:Alt>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/s);
    if (xmpTitle) { hasTitle = true; title = xmpTitle[1]; }
  } catch {}

  const checks = [
    { name: "pdf-header", passed: hasHeader },
    { name: "tagged-structure", passed: hasStruct, details: "StructTreeRoot" },
    { name: "marked-true", passed: hasMarked, details: "MarkInfo /Marked true" },
    { name: "alt-texts-present", passed: hasAlt },
    { name: "embedded-fonts", passed: hasFonts },
    { name: "metadata-title", passed: hasTitle, details: title ? `Titel: ${title}` : undefined }
  ];
  const ok = hasStruct && hasMarked; // Mindestanforderung für getaggte PDFs (Heuristik)
  return { ok, checks };
}

async function analyzeOOXML(buf: Buffer, kind: "docx" | "pptx") {
  const tmpDir = path.join("/tmp", `oox-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const s = unzipper.Extract({ path: tmpDir });
    s.on("close", () => resolve());
    s.on("error", (e: any) => reject(e));
    s.write(buf);
    s.end();
  });

  const checks: { name: string; passed: boolean; details?: string }[] = [];

  if (kind === "docx") {
    const rels = path.join(tmpDir, "word/_rels/document.xml.rels");
    const doc = path.join(tmpDir, "word/document.xml");
    const styles = path.join(tmpDir, "word/styles.xml");
    const hasRels = fs.existsSync(rels);
    const mainXml = fs.existsSync(doc) ? fs.readFileSync(doc, "utf-8") : "";
    const hasAlt = /<wp:docPr[^>]*(?:descr|title)="[^"]+"/i.test(mainXml);
    const hasHeadings = /<w:pStyle[^>]*w:val="Heading[1-6]"/i.test(mainXml) || /<w:outlineLvl/i.test(mainXml);
    checks.push({ name: "oox-structure", passed: hasRels && fs.existsSync(doc) && fs.existsSync(styles) });
    checks.push({ name: "alt-texts-present", passed: hasAlt });
    checks.push({ name: "headings-present", passed: hasHeadings });
    const ok = hasAlt && hasHeadings;
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
}
