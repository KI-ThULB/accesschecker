import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { PDFDocument } from 'pdf-lib';
import unzipper from 'unzipper';

export interface DownloadCheck {
  url: string;
  type: string;
  checks: { name: string; passed: boolean; details?: string }[];
}

/**
 * Prüft Downloads (PDF, DOCX, PPTX) auf einfache Barrierefreiheits-Kriterien
 */
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

      if (type === 'pdf') {
        checks = await checkPdf(buf);
      } else if (type === 'docx' || type === 'pptx') {
        checks = await checkOffice(buf);
      }

      results.push({ url, type, checks });
    } catch (err: any) {
      results.push({
        url,
        type: 'unknown',
        checks: [{ name: 'download-error', passed: false, details: err.message }]
      });
    }
  }

  return results;
}

function detectType(url: string): 'pdf' | 'docx' | 'pptx' | null {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'pptx';
  return null;
}

async function checkPdf(buf: Buffer) {
  const pdfDoc = await PDFDocument.load(buf);
  const meta = pdfDoc.getTitle() || '';
  const hasTags = !!pdfDoc.catalog.get('StructTreeRoot');

  const checks = [
    { name: 'pdf-has-tags', passed: hasTags, details: hasTags ? 'Strukturbaum vorhanden' : 'Kein Strukturbaum' },
    { name: 'pdf-has-title', passed: !!meta, details: meta ? `Titel: ${meta}` : 'Kein Titel im Metadatenfeld' }
  ];
  return checks;
}

async function checkOffice(buf: Buffer) {
  const tmpDir = path.join('/tmp', `doc-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const zipStream = unzipper.Extract({ path: tmpDir });
  zipStream.write(buf);
  zipStream.end();

  await new Promise(resolve => zipStream.on('close', resolve));

  let checks: { name: string; passed: boolean; details?: string }[] = [];
  const relsPath = path.join(tmpDir, 'word', '_rels', 'document.xml.rels');

  if (fs.existsSync(relsPath)) {
    checks.push({ name: 'docx-relations-found', passed: true });
  } else {
    checks.push({ name: 'docx-relations-found', passed: false });
  }

  return checks;
}
