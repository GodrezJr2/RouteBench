import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromEnv, loadConfigFromFile, mergeConfigs } from './config.js';
import { createModelsClient } from './modelsClient.js';
import { createOpenAICompatibleClient } from './openaiClient.js';
import { runBenchmark } from './runner.js';

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

export function getConfigSummary(conf) {
  return {
    base_url: conf.baseUrl || '',
    has_api_key: !!(conf.apiKey),
    models: Array.isArray(conf.models) ? conf.models : [],
    timeout_ms: conf.timeoutMs || 30000,
  };
}

export async function listBenchmarkPacks(benchmarksDir = 'benchmarks') {
  try {
    const entries = await readdir(benchmarksDir);
    const packs = [];
    for (const f of entries.filter((e) => e.endsWith('.json'))) {
      const path = `${benchmarksDir}/${f}`.replace(/\\/g, '/');
      try {
        const raw = await readFile(join(benchmarksDir, f), 'utf8');
        const data = JSON.parse(raw);
        packs.push({ path, id: data.id || f, name: data.name || f, case_count: Array.isArray(data.cases) ? data.cases.length : 0 });
      } catch {
        packs.push({ path, id: f, name: f, case_count: 0 });
      }
    }
    return packs;
  } catch {
    return [];
  }
}

async function tryLoadConfig() {
  try {
    const raw = await readFile('routebench.config.json', 'utf8');
    const fileConf = loadConfigFromFile(JSON.parse(raw));
    const envConf = loadConfigFromEnv();
    return mergeConfigs(fileConf, envConf);
  } catch {
    const envConf = loadConfigFromEnv();
    return { baseUrl: envConf.baseUrl, apiKey: envConf.apiKey, models: envConf.models, timeoutMs: envConf.timeoutMs || 30000, modelCosts: {} };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export function createViewerServer({ port = 3001, resultsDir = 'results' } = {}) {
  const runs = new Map();

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

    if (url.pathname === '/api/config') {
      const conf = await tryLoadConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getConfigSummary(conf)));
      return;
    }

    if (url.pathname === '/api/benchmarks') {
      const packs = await listBenchmarkPacks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ packs }));
      return;
    }

    if (url.pathname === '/api/discover' && req.method === 'POST') {
      const conf = await tryLoadConfig();
      if (!conf.baseUrl || !conf.apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'endpoint not configured — set base_url and api_key in routebench.config.json' }));
        return;
      }
      try {
        const client = createModelsClient({ baseUrl: conf.baseUrl, apiKey: conf.apiKey, timeoutMs: conf.timeoutMs });
        const discovery = await client();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(discovery));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (url.pathname === '/api/run') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const models = Array.isArray(body.models) ? body.models.map(String).filter(Boolean) : [];
        const benchmarkPath = typeof body.benchmark === 'string' && body.benchmark ? body.benchmark : 'benchmarks/phase0.json';

        if (models.length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'at least 2 models required' }));
          return;
        }

        let benchmarkData;
        try {
          const raw = await readFile(benchmarkPath, 'utf8');
          benchmarkData = JSON.parse(raw);
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `cannot load benchmark: ${err.message}` }));
          return;
        }

        const runId = Date.now().toString();
        const totalCases = models.length * benchmarkData.cases.length;
        const outputPath = `${resultsDir}/run-${runId}.json`.replace(/\\/g, '/');
        runs.set(runId, { status: 'running', progress: { done: 0, total: totalCases }, result_path: null, error: null });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ run_id: runId, total_cases: totalCases }));

        (async () => {
          const run = runs.get(runId);
          try {
            const conf = await tryLoadConfig();
            if (!conf.baseUrl || !conf.apiKey) throw new Error('endpoint not configured — set base_url and api_key in routebench.config.json');
            const client = createOpenAICompatibleClient({ baseUrl: conf.baseUrl, apiKey: conf.apiKey, timeoutMs: conf.timeoutMs });
            const result = await runBenchmark({
              models,
              cases: benchmarkData.cases,
              client,
              modelCosts: conf.modelCosts || {},
              onProgress(done, total) { if (run) run.progress = { done, total }; },
            });
            await mkdir(resultsDir, { recursive: true });
            await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
            if (run) { run.status = 'done'; run.result_path = outputPath; }
          } catch (err) {
            if (run) { run.status = 'error'; run.error = err.message; }
          }
        })();

        return;
      }

      if (req.method === 'GET') {
        const runId = url.searchParams.get('id');
        const run = runs.get(runId);
        if (!run) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'run not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return server;
}
