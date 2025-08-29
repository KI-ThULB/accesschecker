import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import unzipper from 'unzipper';

/** Analyze basic PDF accessibility metadata. */
export async function analyzePdf(buf: Buffer) {
  let doc: any = null;
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false });
    doc = await task.promise;
  } catch {}
  const meta = doc ? await doc.getMetadata().catch(() => ({ info: {}, metadata: null } as any)) : { info: {}, metadata: null };
  const pages = doc?.numPages || 0;
  const txt = buf.toString('latin1');
  const tagged = /\/StructTreeRoot/.test(txt) && /\/MarkInfo\s*<<?[^>]*\/Marked\s*true/i.test(txt);
  const hasLang = Boolean(meta.info?.Lang || /\/Lang\s*\([^)]*\)/i.test(txt));
  const hasTitle = Boolean(meta.info?.Title || /\/Title\s*\([^)]*\)/.test(txt));
  const hasOutline = /\/Outlines\s+\d+\s+0\s+R/.test(txt);
  return { tagged, hasLang, hasTitle, hasOutline, pages };
}

/** Inspect OOXML (docx/xlsx/pptx) for simple accessibility hints. */
export async function analyzeOffice(buf: Buffer, kind: 'docx'|'xlsx'|'pptx') {
  const zip = await unzipper.Open.buffer(buf);
  const paths = zip.files.map(f => f.path);
  const coreFile = zip.files.find(f => f.path === 'docProps/core.xml');
  let title = '';
  let creator = '';
  let subject = '';
  if (coreFile) {
    const coreTxt = (await coreFile.buffer()).toString('utf-8');
    title = (coreTxt.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] || '').trim();
    creator = (coreTxt.match(/<dc:creator>([^<]*)<\/dc:creator>/)?.[1] || '').trim();
    subject = (coreTxt.match(/<dc:subject>([^<]*)<\/dc:subject>/)?.[1] || '').trim();
  }
  let slideCount = 0;
  let sheetCount = 0;
  let hasAltTextHints = false;
  for (const f of zip.files) {
    if (kind === 'pptx' && f.path.startsWith('ppt/slides/slide') && f.path.endsWith('.xml')) slideCount++;
    if (kind === 'xlsx' && f.path.startsWith('xl/worksheets/sheet') && f.path.endsWith('.xml')) sheetCount++;
    if (kind === 'pptx' && f.path.startsWith('ppt/slides/') && f.path.endsWith('.xml')) {
      const txt = (await f.buffer()).toString('utf-8');
      if (/a:descr="[^"]+"/.test(txt)) hasAltTextHints = true;
    }
  }
  return { title, creator, subject, slideCount, sheetCount, hasAltTextHints };
}

/** Basic CSV/TXT heuristics: encoding and delimiter detection. */
export function analyzeCsvTxt(buf: Buffer) {
  let encoding = 'utf-8';
  let text = buf.toString('utf8');
  if (text.includes('\uFFFD')) {
    encoding = 'unknown';
    text = buf.toString('latin1');
  }
  const lines = text.split(/\r\n|\n/);
  const first = lines[0] || '';
  const { delimiter, confidence } = detectDelimiter(first);
  let consistent = true;
  if (delimiter) {
    const count = first.split(delimiter).length;
    for (const l of lines.slice(1)) {
      if (l.trim() === '') continue;
      if (l.split(delimiter).length !== count) { consistent = false; break; }
    }
  }
  return { encoding, delimiter, delimiterConsistent: consistent, delimiterConfidence: confidence };
}

export function detectDelimiter(line: string): { delimiter: string; confidence: number } {
  const candidates: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  for (const d of Object.keys(candidates)) candidates[d] = (line.match(new RegExp(d === '\\t' ? '\\t' : d, 'g')) || []).length;
  const entries = Object.entries(candidates).sort((a, b) => b[1] - a[1]);
  const [delim, count] = entries[0];
  const confidence = line.length ? count / line.length : 0;
  return { delimiter: count > 0 ? (delim === '\\t' ? '\t' : delim) : '', confidence };
}

