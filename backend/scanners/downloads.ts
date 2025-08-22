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
  return { tagged, hasLang, hasTitle, pages };
}

/** Inspect OOXML (docx/xlsx/pptx) for simple accessibility hints. */
export async function analyzeOffice(buf: Buffer, kind: 'docx'|'xlsx'|'pptx') {
  const zip = await unzipper.Open.buffer(buf);
  const paths = zip.files.map(f => f.path);
  const hasCore = paths.includes('docProps/core.xml');
  let imageRelCount = 0;
  if (kind === 'pptx') {
    for (const f of zip.files) {
      if (f.path.startsWith('ppt/slides/_rels/') && f.path.endsWith('.rels')) {
        const content = await f.buffer();
        const txt = content.toString('utf-8');
        imageRelCount += (txt.match(/Target="..\/media\//g) || []).length;
      }
    }
  }
  return { hasCoreProps: hasCore, imageRelCount };
}

/** Basic CSV/TXT heuristics: UTF-8, line endings, delimiter consistency. */
export function analyzeCsvTxt(buf: Buffer) {
  const text = buf.toString('utf8');
  const encodingOk = !text.includes('\uFFFD');
  const lines = text.split(/\r\n|\n/);
  const lineEndingsOk = !(text.includes('\r') && text.includes('\n') && !text.includes('\r\n'));
  const first = lines[0] || '';
  const delimiter = detectDelimiter(first);
  let consistent = true;
  if (delimiter) {
    const count = first.split(delimiter).length;
    for (const l of lines.slice(1)) {
      if (l.trim() === '') continue;
      if (l.split(delimiter).length !== count) { consistent = false; break; }
    }
  }
  return { encodingOk, lineEndingsOk, delimiter, delimiterConsistent: consistent };
}

export function detectDelimiter(line: string): string {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
  if (line.includes(',')) return ',';
  return '';
}

