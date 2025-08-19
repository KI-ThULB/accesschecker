import { test } from 'node:test';
import assert from 'node:assert';
import { contentTypeToLabel } from '../scripts/lib/mime.js';

test('maps known content types', () => {
  assert.equal(contentTypeToLabel('application/pdf'), 'PDF');
  assert.equal(contentTypeToLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'DOCX');
});

test('falls back to extension', () => {
  assert.equal(contentTypeToLabel(undefined, 'https://example.com/file.pptx'), 'PPTX');
});

test('unknown types yield Unknown', () => {
  assert.equal(contentTypeToLabel('application/x-foo', 'https://x/baz.unknown'), 'Unknown');
});
