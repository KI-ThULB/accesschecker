import { test } from 'node:test';
import assert from 'node:assert';
import { analyzePdf, analyzeOOXML } from '../scanners/downloads.js';
import JSZip from 'jszip';

test('pdf without outline triggers manual review', () => {
  const buf = Buffer.from('%PDF-1.4\n1 0 obj<<>>\nendobj\ntrailer<<>>\n%%EOF');
  const res = analyzePdf(buf);
  assert.equal(res.needsManualReview, true);
});

test('docx without alt text fails check', async () => {
  const zip = new JSZip();
  const doc = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><wp:docPr/></w:drawing></w:r></w:p>' +
    '</w:body></w:document>';
  zip.file('word/document.xml', doc);
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const res = await analyzeOOXML(buf, 'docx');
  const altCheck = res.checks.find(c => c.name === 'alt-texts-present');
  assert.ok(altCheck && altCheck.passed === false);
});
