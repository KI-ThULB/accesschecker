import { test } from 'node:test';
import assert from 'node:assert';
import { analyzePdf, analyzeCsvTxt } from '../scanners/downloads.js';

test('PDF tagging heuristic with and without StructTreeRoot', async () => {
  const taggedBuf = Buffer.from('%PDF-1.4\n1 0 obj<< /StructTreeRoot 2 0 R /MarkInfo <</Marked true>> >>\nendobj\ntrailer<<>>\n%%EOF');
  const untaggedBuf = Buffer.from('%PDF-1.4\n1 0 obj<< /MarkInfo <</Marked true>> >>\nendobj\ntrailer<<>>\n%%EOF');
  const tagged = await analyzePdf(taggedBuf);
  const untagged = await analyzePdf(untaggedBuf);
  assert.equal(tagged.tagged, true);
  assert.equal(untagged.tagged, false);
});

test('CSV delimiter heuristic detects mismatch', () => {
  const buf = Buffer.from('a,b,c\n1;2;3');
  const res = analyzeCsvTxt(buf);
  assert.equal(res.delimiter, ',');
  assert.equal(res.delimiterConsistent, false);
});

