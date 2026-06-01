import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const HTML_PAGE = readFileSync(join(__dirname, 'viewer.html'), 'utf8');

export function sanitizePath(filePath, resultsDir) {
  if (!filePath) throw new Error('file path required');
  const base = resolve(resultsDir);
  const target = resolve(filePath);
  if (!target.startsWith(base + sep)) {
    throw new Error('path traversal not allowed');
  }
  return target;
}

export async function listResultFiles(resultsDir = 'results') {
  try {
    const entries = await readdir(resultsDir);
    return entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => `${resultsDir}/${f}`.replace(/\\/g, '/'));
  } catch {
    return [];
  }
}

export function createViewerServer({ port = 3001, resultsDir = 'results' } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    if (url.pathname === '/api/files') {
      const files = await listResultFiles(resultsDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
      return;
    }

    if (url.pathname === '/api/file') {
      const filePath = url.searchParams.get('path');
      try {
        const safe = sanitizePath(filePath, resultsDir);
        const data = await readFile(safe, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch (err) {
        const status = err.message.includes('traversal') || err.message.includes('required') ? 403 : 404;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return server;
}
