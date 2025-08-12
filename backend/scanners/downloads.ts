import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { PDFDocument } from "pdf-lib";
import unzipper from "unzipper";

export interface DownloadCheck {
  url: string;
  type: string;
  checks: { name: string; passed: boolean; details?: string }[];
}

export async function checkDownloads(urls: string[]): Promise<DownloadCheck[]> {
  const results: DownloadCheck[] = [];

  for (const url of urls) {
    try {
      const type = detectType(url);
      if (!type) continue;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const buf = Buffer.from(await res.arrayBuffer());
      let checks: DownloadCheck["checks"] = [];

      if (type === "pdf") {
        checks = await checkPdf(buf);
      } else if (type === "docx" || type === "pptx") {
        checks = await checkOffice(buf, type);
      }

      results.push({ url, type, checks });
    } catch (err: any) {
      results.push({
        url,
        type: "unknown",
        checks: [{ name: "download-error", passed: false, details: String(err?.message || err) }],
      });
    }
  }

  return results;
}

function detectType(url: string): "pdf" | "docx" | "pptx" | null {
  const ext = url.split(".").pop()?.toLowerCase().split("?")[0];
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  return null;
}

async function checkPdf(buf: Buffer) {
  const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const title = pdfDoc.getTitle() || "";
  // pdf-lib liefert keinen einfachen Getter für Tags – heuristisch via Katalog:
  const hasTags = !!(pdfDoc as any)?.catalog?.get?.("StructTreeRoot");

  return [
    { name: "pdf-has-tags", passed: hasTags, details: hasTags ? "Strukturbaum vorhanden" : "Kein Strukturbaum" },
    { name: "pdf-has-title", passed: !!title, details: title ? `Titel: ${title}` : "Kein Titel im Metadatenfeld" },
  ];
}

async function checkOffice(buf: Buffer, type: "docx" | "pptx") {
  const tmpDir = path.join("/tmp", `ac-${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const s = unzipper.Extract({ path: tmpDir });
    s.on("close", () => resolve());
    s.on("error", (e: any) => reject(e));
    s.write(buf);
    s.end();
  });

  const checks: { name: string; passed: boolean; details?: string }[] = [];

  if (type === "docx") {
    const rels = path.join(tmpDir, "word", "_rels", "document.xml.rels");
    checks.push({ name: "docx-has-relations", passed: fs.existsSync(rels) });
    const styles = path.join(tmpDir, "word", "styles.xml");
    checks.push({ name: "docx-has-styles", passed: fs.existsSync(styles) });
  } else {
    const pres = path.join(tmpDir, "ppt", "presentation.xml");
    checks.push({ name: "pptx-has-presentation-xml", passed: fs.existsSync(pres) });
  }

  return checks;
}
