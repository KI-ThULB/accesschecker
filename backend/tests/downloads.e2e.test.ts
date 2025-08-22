import { test } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { main as engineMain } from '../core/engine.js';
import { main as buildReports } from '../scripts/build-reports.js';

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/downloads');

function serveFixtures() {
  const server = createServer(async (req, res) => {
    try {
      const file = path.join(FIXTURE_DIR, req.url === '/' ? 'index.html' : req.url!.slice(1));
      const data = await fs.readFile(file);
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, () => {
      const address = server.address() as any;
      resolve({ url: `http://localhost:${address.port}/`, close: () => server.close() });
    });
  });
}

test('downloads module discovers and reports files', async (t) => {
  const srv = await serveFixtures();
  await fs.rm(path.join(process.cwd(), 'out'), { recursive: true, force: true });
  const prevArgv = process.argv;
  process.argv = ['node', 'engine', '--url', srv.url, '--profile', 'fast'];
  try {
    await engineMain();
    const resJson = JSON.parse(await fs.readFile(path.join('out', 'results.json'), 'utf-8'));
    assert.ok(resJson.modules.downloads.stats.total >= 2);
    const issues = JSON.parse(await fs.readFile(path.join('out', 'issues.json'), 'utf-8'));
    assert.ok(issues.some((i: any) => /^pdf:|^csv:/.test(i.id)));
    await buildReports();
    const report = await fs.readFile(path.join('out', 'report_internal.html'), 'utf-8');
    assert.ok(/Pr\u00fcfung von Downloads/.test(report) && !/Keine pr\u00fcfbaren Downloads/.test(report));
  } finally {
    process.argv = prevArgv;
    srv.close();
  }
});
