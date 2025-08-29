import fetch from 'node-fetch';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Module, DownloadFinding, Severity, NormRefs } from '../../core/types.js';
import { analyzePdf, analyzeOffice, analyzeCsvTxt } from '../../scanners/downloads.js';

const VERSION = '0.2.0';
const MAX_PER_PAGE = 20;
const MAX_SIZE_MB = 15;

const findingMeta: Record<string, { severity: Severity; summary: string; norms?: NormRefs }> = {
  'downloads:pdf-untagged': { severity: 'serious', summary: 'PDF is not tagged', norms: { wcag: ['1.3.1'], en301549: ['9.1.3.1'] } },
  'downloads:pdf-missing-lang': { severity: 'moderate', summary: 'PDF document language missing', norms: { wcag: ['3.1.1'] } },
  'downloads:pdf-missing-title': { severity: 'minor', summary: 'PDF document title missing', norms: { wcag: ['2.4.2'] } },
  'downloads:office-missing-title': { severity: 'minor', summary: 'Office document title missing' },
  'downloads:office-alttext-review': { severity: 'minor', summary: 'Review images for alternative text' },
  'downloads:csv-unknown-encoding': { severity: 'minor', summary: 'File not UTF-8 encoded' },
  'downloads:csv-delimiter-ambiguous': { severity: 'minor', summary: 'Ambiguous delimiter usage' },
};

function makeFinding(id: keyof typeof findingMeta, pageUrl: string, downloadUrl: string): DownloadFinding {
  const meta = findingMeta[id];
  const f: DownloadFinding = {
    id,
    module: 'downloads',
    severity: meta.severity,
    summary: meta.summary,
    details: meta.summary,
    pageUrl,
    downloadUrl,
  };
  if (meta.norms) f.norms = meta.norms;
  return f;
}

const mod: Module = {
  slug: 'downloads',
  version: VERSION,
  async run(ctx) {
    const hrefs: string[] = await ctx.page.$$eval('a[href]', (els: any) => els.map((a: any) => a.getAttribute('href')));
    const urls: string[] = [];
    for (const href of hrefs) {
      if (!href) continue;
      if (/\.(pdf|docx|xlsx|pptx|csv|txt|zip)(?:$|[?#])/i.test(href)) {
        try { urls.push(new URL(href, ctx.url).toString()); } catch {}
      }
    }
    const unique = Array.from(new Set(urls)).slice(0, MAX_PER_PAGE);

    const findings: DownloadFinding[] = [];
    const index: any[] = [];
    const stats: any = { total: unique.length, pdf: 0, office: 0, csv: 0, txt: 0, zip: 0,
      pdfUntagged: 0, pdfMissingLang: 0, officeMissingTitle: 0 };

    for (const url of unique) {
      const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0];
      if (ext === 'pdf') stats.pdf++;
      else if (['docx','xlsx','pptx'].includes(ext)) stats.office++;
      else if (ext === 'csv') stats.csv++;
      else if (ext === 'txt') stats.txt++;
      else if (ext === 'zip') stats.zip++;

      if (ext === 'zip') {
        index.push({ url, pageUrl: ctx.url, type: ext, status: 'skipped' });
        continue;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
        clearTimeout(timeout);
        if (!head.ok) throw new Error(`HTTP ${head.status}`);
        const maxMb = Number(ctx.config.downloadMaxSizeMB) || MAX_SIZE_MB;
        const maxBytes = maxMb * 1024 * 1024;
        const len = Number(head.headers.get('content-length') || '0');
        const contentType = head.headers.get('content-type') || '';
        if (len && len > maxBytes) {
          index.push({ url, pageUrl: ctx.url, type: ext, status: 'skipped', note: 'too-large', size: len, contentType });
          continue;
        }
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 15000);
        const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller2.signal });
        clearTimeout(timeout2);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const size = buf.length;
        const filename = path.basename(new URL(url).pathname);
        const rec: any = { url, pageUrl: ctx.url, type: ext, contentType: contentType || res.headers.get('content-type') || '', size, filename, checks: [], status: 'ok' };

        if (ext === 'pdf') {
          const r = await analyzePdf(buf);
          const h = createHash('sha1').update(url).digest('hex');
          await ctx.saveArtifact(`pdf_meta/${h}.json`, r);
          if (!r.tagged) { rec.checks.push('downloads:pdf-untagged'); findings.push(makeFinding('downloads:pdf-untagged', ctx.url, url)); stats.pdfUntagged++; }
          if (!r.hasLang) { rec.checks.push('downloads:pdf-missing-lang'); findings.push(makeFinding('downloads:pdf-missing-lang', ctx.url, url)); stats.pdfMissingLang++; }
          if (!r.hasTitle) { rec.checks.push('downloads:pdf-missing-title'); findings.push(makeFinding('downloads:pdf-missing-title', ctx.url, url)); }
          rec.meta = { pages: r.pages, hasOutline: r.hasOutline };
        } else if (['docx','xlsx','pptx'].includes(ext)) {
          const r = await analyzeOffice(buf, ext as any);
          const h = createHash('sha1').update(url).digest('hex');
          await ctx.saveArtifact(`office_meta/${h}.json`, r);
          if (!r.title) { rec.checks.push('downloads:office-missing-title'); findings.push(makeFinding('downloads:office-missing-title', ctx.url, url)); stats.officeMissingTitle++; }
          if (ext === 'pptx' && r.hasAltTextHints) { rec.checks.push('downloads:office-alttext-review'); findings.push(makeFinding('downloads:office-alttext-review', ctx.url, url)); }
          rec.meta = { title: r.title, creator: r.creator, subject: r.subject,
            slideCount: r.slideCount, sheetCount: r.sheetCount, hasAltTextHints: r.hasAltTextHints };
        } else if (['csv','txt'].includes(ext)) {
          const r = analyzeCsvTxt(buf);
          const h = createHash('sha1').update(url).digest('hex');
          await ctx.saveArtifact(`text_meta/${h}.json`, r);
          if (r.encoding !== 'utf-8') { rec.checks.push('downloads:csv-unknown-encoding'); findings.push(makeFinding('downloads:csv-unknown-encoding', ctx.url, url)); }
          if (!r.delimiter || r.delimiterConfidence < 0.2) { rec.checks.push('downloads:csv-delimiter-ambiguous'); findings.push(makeFinding('downloads:csv-delimiter-ambiguous', ctx.url, url)); }
          rec.meta = { encoding: r.encoding, delimiter: r.delimiter, delimiterConfidence: r.delimiterConfidence };
        }

        if (rec.checks.length) rec.status = 'error';
        index.push(rec);
      } catch (e: any) {
        index.push({ url, pageUrl: ctx.url, type: ext, status: 'skipped', note: String(e) });
      }
    }

    const indexPath = await ctx.saveArtifact('downloads_index.json', index);
    return { module: 'downloads', version: VERSION, findings, stats, artifacts: { index: indexPath } };
  }
};

export default mod;

