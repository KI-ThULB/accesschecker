import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import unzipper from "unzipper";

export interface DownloadCheck {
  url: string;
  type: "pdf" | "doc" | "docx" | "ppt" | "pptx" | "other";
  ok: boolean;
  checks: { name: string; passed: boolean; details?: string }[];
  note?: string;
  legacyFormat?: boolean;
  needsManualReview?: boolean;
}

interface Options {
  types: string[];
  maxBytes: number;
}

function extType(u: string): DownloadCheck["type"] {
  const m = u.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  const ext = m ? m[1] : "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (ext === "doc") return "doc";
  if (ext === "ppt") return "ppt";
  return "other";
}

function limitBuffer(buf: Buffer, maxBytes: number) {
  const truncated = buf.length > maxBytes;
  return { buf: truncated ? buf.slice(0, maxBytes) : buf, truncated };
}

export async function checkDownloads(urls: string[], opts: Options): Promise<DownloadCheck[]> {
  const out: DownloadCheck[] = [];
  for (const url of urls) {
    const t = extType(url);
    if (!opts.types.includes(t)) continue;

    // Legacy-Binärformate: nicht automatisch prüfbar (DOC/PPT)
    if (t === "doc" || t === "ppt") {
      out.push({
        url, type: t, ok: false,
        legacyFormat: true,
        needsManualReview: true,
        note: "Altes Binary-Format – automatische BITV/WCAG-Prüfung nicht möglich. Bitte in DOCX/PPTX oder PDF/UA konvertieren.",
        checks: [{ name: "legacy-format", passed: false, details: "Nicht automatisch prüfbar" }],
      });
      continue;
    }

    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { redirect: "follow", signal: controller.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const { buf, truncated } = limitBuffer(raw, opts.maxBytes);

      if (t === "pdf") {
        const { ok, checks } = analyzePdf(buf);
        out.push({ url, type: t, ok, checks, note: truncated ? `truncated at ${opts.maxBytes} bytes` : undefined });
        continue;
      }
      if (t === "docx" || t === "pptx") {
        const { ok, checks } = await analyzeOOXML(buf, t);
        out.push({ url, type: t, ok, checks, note: truncated ? `truncated at ${opts.maxBytes} bytes` : undefined });
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

function analyzePdf(buf: Buffer): { ok: boolean; checks: { name: string; passed: boolean; details?: string }[] } {
  const txt = buf.toString('latin1');
  const checks: { name: string; passed: boolean; details?: string }[] = [];
  const hasText = /\([^)]{3,}\)\s*TJ?/.test(txt);
  const hasTitle = /\/Title\s*\([^)]{1,}\)/.test(txt) || /<dc:title>[^<]+<\/dc:title>/i.test(txt);
  const hasOutline = /\/Outlines\s+\d+\s+0\s+R/.test(txt);

  checks.push({ name: 'text-content', passed: hasText });
  checks.push({ name: 'title-metadata', passed: hasTitle });
  checks.push({ name: 'outline-present', passed: hasOutline });

  const ok = hasText && hasTitle;
  return { ok, checks };
}

async function analyzeOOXML(buf: Buffer, kind: "docx" | "pptx"): Promise<{ ok: boolean; checks: { name: string; passed: boolean; details?: string }[] }> {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), "oox-"));
  try {
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
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
