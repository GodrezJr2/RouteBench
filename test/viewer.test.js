import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { sanitizePath, listResultFiles, HTML_PAGE } from '../src/viewerServer.js';

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
  assert.ok(HTML_PAGE.length > 2000);
});
