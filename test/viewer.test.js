import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { sanitizePath, listResultFiles, HTML_PAGE, getConfigSummary, listBenchmarkPacks } from '../src/viewerServer.js';

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

test('HTML_PAGE is a non-empty HTML string with required sections', () => {
  assert.equal(typeof HTML_PAGE, 'string');
  assert.ok(HTML_PAGE.includes('<!DOCTYPE html>'));
  assert.ok(HTML_PAGE.includes('RouteBench'));
  assert.ok(HTML_PAGE.includes('/api/files'));
  assert.ok(HTML_PAGE.includes('/api/file'));
  assert.ok(HTML_PAGE.includes('/api/config'));
  assert.ok(HTML_PAGE.includes('/api/run'));
  assert.ok(HTML_PAGE.length > 2000);
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
