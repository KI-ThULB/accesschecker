import { test } from 'node:test';
import assert from 'node:assert';
import { analyzePdf } from '../scanners/downloads.js';

test('pdf without outline triggers manual review', () => {
  const buf = Buffer.from('%PDF-1.4\n1 0 obj<<>>\nendobj\ntrailer<<>>\n%%EOF');
  const res = analyzePdf(buf);
  assert.equal(res.needsManualReview, true);
});
