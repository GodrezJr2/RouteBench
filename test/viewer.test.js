import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { sanitizePath, listResultFiles, HTML_PAGE, COMPARE_PAGE, getConfigSummary, listBenchmarkPacks, createViewerServer } from '../src/viewerServer.js';
import { createSampleResult } from '../src/cliCore.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function withExportServer(fn) {
  const dir = join(tmpdir(), `routebench-export-test-${process.pid}-${Math.floor(performance.now())}`);
  await mkdir(dir, { recursive: true });
  const result = await createSampleResult();
  const resultPath = join(dir, 'sample.json');
  await writeFile(resultPath, JSON.stringify(result));
  const server = createViewerServer({ resultsDir: dir });
  const port = await listen(server);
  try {
    return await fn({ port, dir, resultPath });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('sanitizePath allows file inside results dir', () => {
  const resolved = sanitizePath('results/foo.json', 'results');
  assert.ok(resolved.endsWith('foo.json'));
  assert.ok(resolved.includes('results'));
});

test('sanitizePath blocks path traversal with ../', () => {
  assert.throws(() => sanitizePath('../secrets.json', 'results'), /traversal/);
});

test('sanitizePath blocks absolute path outside results', () => {
  const absOutside = process.platform === 'win32' ? 'C:\\Windows\\System32\\foo.json' : '/etc/passwd';
  assert.throws(() => sanitizePath(absOutside, 'results'), /traversal/);
});

test('sanitizePath throws on empty path', () => {
  assert.throws(() => sanitizePath('', 'results'), /required/);
});

test('sanitizePath throws on null path', () => {
  assert.throws(() => sanitizePath(null, 'results'), /required/);
});

test('listResultFiles returns empty array when dir does not exist', async () => {
  const files = await listResultFiles('nonexistent-dir-routebench-xyz-99');
  assert.deepEqual(files, []);
});

test('listResultFiles returns only .json files', async () => {
  const dir = join(tmpdir(), `routebench-viewer-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.json'), '{}');
  await writeFile(join(dir, 'report.md'), '# report');
  await writeFile(join(dir, 'other.json'), '{}');
  await writeFile(join(dir, 'routing.json'), '{}');

  const files = await listResultFiles(dir);
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => f.endsWith('.json')));
  assert.ok(files.every((f) => !f.endsWith('.md')));

  await rm(dir, { recursive: true, force: true });
});

test('listResultFiles uses forward slashes in returned paths', async () => {
  const dir = join(tmpdir(), `routebench-viewer-test2-${process.pid}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'test.json'), '{}');

  const files = await listResultFiles(dir);
  assert.ok(files.every((f) => !f.includes('\\')));

  await rm(dir, { recursive: true, force: true });
});

test('HTML_PAGE is the redesigned dashboard', () => {
  assert.equal(typeof HTML_PAGE, 'string');
  assert.ok(HTML_PAGE.includes('<!DOCTYPE html>'));
  assert.ok(HTML_PAGE.includes('RouteBench'));
  assert.ok(HTML_PAGE.includes('/api/dashboard'));
  assert.ok(HTML_PAGE.includes('/api/runs'));
  assert.ok(HTML_PAGE.includes('Connect & Run'));
  assert.ok(!HTML_PAGE.includes('oklch(11%'));
  assert.ok(!HTML_PAGE.includes('Failure Diagnosis'));
  assert.ok(HTML_PAGE.length > 2000);
});

test('GET / serves the redesigned dashboard instead of the old dark viewer', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type').includes('text/html'));
    const html = await r.text();
    assert.ok(html.includes('/api/dashboard'));
    assert.ok(html.includes('Connect & Run'));
    assert.ok(!html.includes('oklch(11%'));
    assert.ok(!html.includes('Failure Diagnosis'));
  });
});

test('dashboard includes product UI polish affordances', () => {
  assert.ok(HTML_PAGE.includes('class="skip-link"'));
  assert.ok(HTML_PAGE.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(HTML_PAGE.includes('skeleton-card'));
  assert.ok(!/background-clip:\s*text/.test(HTML_PAGE));
  assert.ok(!/border-left:\s*[2-9]px/.test(HTML_PAGE));
});

test('compare page uses the same accessible light product shell', () => {
  assert.ok(COMPARE_PAGE.includes('class="skip-link"'));
  assert.ok(COMPARE_PAGE.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(COMPARE_PAGE.includes('github.min.css'));
  assert.ok(!/background-clip:\s*text/.test(COMPARE_PAGE));
});

test('dashboard supports manual model IDs when discovery misses a model', () => {
  assert.ok(HTML_PAGE.includes('manual-models'));
  assert.ok(HTML_PAGE.includes('manualModels'));
  assert.ok(HTML_PAGE.includes('oc/north-mini-code-free'));
  assert.ok(HTML_PAGE.includes('manual.length'));
  assert.ok(HTML_PAGE.includes('Array.from(selected).concat(manualModels())'));
});

test('compare page can add a manual model without discovery', () => {
  assert.ok(COMPARE_PAGE.includes('manual-model'));
  assert.ok(COMPARE_PAGE.includes('addManualModel'));
  assert.ok(COMPARE_PAGE.includes('oc/north-mini-code-free'));
  assert.ok(COMPARE_PAGE.includes('manual.value.trim()'));
});

test('getConfigSummary returns summary without api_key', () => {
  const summary = getConfigSummary({ baseUrl: 'http://localhost/v1', apiKey: 'sk-secret', models: ['a', 'b'], timeoutMs: 30000 });
  assert.equal(summary.base_url, 'http://localhost/v1');
  assert.equal(summary.has_api_key, true);
  assert.deepEqual(summary.models, ['a', 'b']);
  assert.equal(summary.timeout_ms, 30000);
  assert.ok(!('api_key' in summary));
  assert.ok(!('apiKey' in summary));
});

test('getConfigSummary has_api_key false when key is empty', () => {
  const summary = getConfigSummary({ baseUrl: '', apiKey: '', models: [], timeoutMs: 0 });
  assert.equal(summary.has_api_key, false);
  assert.equal(summary.base_url, '');
  assert.equal(summary.timeout_ms, 30000);
});

test('listBenchmarkPacks returns empty when dir missing', async () => {
  const packs = await listBenchmarkPacks('nonexistent-bench-dir-xyz-99');
  assert.deepEqual(packs, []);
});

test('listBenchmarkPacks returns pack metadata from benchmarks dir', async () => {
  const dir = join(tmpdir(), `routebench-bench-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sample.json'), JSON.stringify({ id: 'test_pack', name: 'Test Pack', cases: [{}, {}] }));
  await writeFile(join(dir, 'notes.md'), '# notes');

  const packs = await listBenchmarkPacks(dir);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].id, 'test_pack');
  assert.equal(packs[0].name, 'Test Pack');
  assert.equal(packs[0].case_count, 2);
  assert.ok(packs[0].path.endsWith('sample.json'));

  await rm(dir, { recursive: true, force: true });
});

test('GET /api/export?format=report returns markdown report', async () => {
  await withExportServer(async ({ port, resultPath }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/export?path=${encodeURIComponent(resultPath)}&format=report`);
    assert.equal(r.status, 200);
    assert.ok((r.headers.get('content-type') || '').includes('markdown'));
    const text = await r.text();
    assert.ok(text.includes('#'));
    assert.ok(text.length > 50);
  });
});

test('GET /api/export?format=routing returns routing JSON without api_key', async () => {
  await withExportServer(async ({ port, resultPath }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/export?path=${encodeURIComponent(resultPath)}&format=routing`);
    assert.equal(r.status, 200);
    const json = JSON.parse(await r.text());
    assert.equal(json.schema_version, 'routebench.routing.v1');
    assert.ok(!('api_key' in json));
    assert.ok(Array.isArray(json.routing_rules));
  });
});

test('GET /api/export rejects unknown format with 400', async () => {
  await withExportServer(async ({ port, resultPath }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/export?path=${encodeURIComponent(resultPath)}&format=bogus`);
    assert.equal(r.status, 400);
    const json = JSON.parse(await r.text());
    assert.ok(json.error.includes('unknown export format'));
  });
});

test('GET /api/export blocks path traversal with 403', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/export?path=${encodeURIComponent('../../secrets.json')}&format=report`);
    assert.equal(r.status, 403);
  });
});

test('POST /api/run returns cases_per_pack and models for progress detail', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: ['m1', 'm2'], benchmark: 'benchmarks/phase0.json' }),
    });
    assert.equal(r.status, 200);
    const json = await r.json();
    assert.ok(json.run_id);
    assert.equal(json.cases_per_pack, 30);
    assert.equal(json.total_cases, 60);
    assert.deepEqual(json.models, ['m1', 'm2']);
  });
});

test('GET /api/runs lists result files with summaries', async () => {
  await withExportServer(async ({ port, resultPath }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(r.status, 200);
    const json = await r.json();
    assert.ok(Array.isArray(json.runs));
    assert.ok(json.runs.some((run) => run.path.endsWith('sample.json')));
    assert.ok(json.runs.every((run) => Array.isArray(run.models)));
  });
});

test('GET /api/dashboard builds a payload from a result file', async () => {
  await withExportServer(async ({ port, resultPath }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/dashboard?path=${encodeURIComponent(resultPath)}`);
    assert.equal(r.status, 200);
    const json = await r.json();
    assert.ok(Array.isArray(json.profiles));
    assert.ok(Array.isArray(json.ranked));
    assert.ok(Array.isArray(json.verdict));
    assert.ok('languages' in json);
  });
});

test('GET /api/dashboard blocks path traversal with 403', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/dashboard?path=${encodeURIComponent('../../secrets.json')}`);
    assert.equal(r.status, 403);
  });
});

test('POST /api/chat-compare requires models and a prompt', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/chat-compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // supply base_url so the handler reaches model/prompt validation
      // instead of the earlier "no endpoint" gate (which depends on local config)
      body: JSON.stringify({ base_url: 'http://127.0.0.1:1/v1', models: [], prompt: '' }),
    });
    assert.equal(r.status, 400);
    const json = await r.json();
    assert.ok(/model|prompt|requests/i.test(json.error));
  });
});

test('POST /api/chat-compare rejects empty multi-turn requests[]', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/chat-compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ model: 'm' }] }), // no messages array → filtered out
    });
    assert.equal(r.status, 400);
  });
});

test('GET /compare serves the chat-compare page', async () => {
  await withExportServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/compare`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type').includes('text/html'));
    const html = await r.text();
    assert.ok(html.includes('/api/chat-compare'));
  });
});

test('COMPARE_PAGE wires the chat-compare and discover endpoints', () => {
  assert.ok(COMPARE_PAGE.includes('/api/chat-compare'));
  assert.ok(COMPARE_PAGE.includes('/api/discover'));
});
