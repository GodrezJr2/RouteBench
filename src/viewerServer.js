import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromEnv, loadConfigFromFile, mergeConfigs } from './config.js';
import { createModelsClient } from './modelsClient.js';
import { createOpenAICompatibleClient, createChatClient } from './openaiClient.js';
import { renderMarkdownReport } from './report.js';
import { buildDashboard, mergeResults } from './profile.js';
import { renderRouteExport } from './routeExport.js';
import { runBenchmark } from './runner.js';
import { resultToHistoryEntry } from './history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const HTML_PAGE = readFileSync(join(__dirname, 'dashboard.html'), 'utf8');
export const DASHBOARD_PAGE = HTML_PAGE;
export const COMPARE_PAGE = readFileSync(join(__dirname, 'compare.html'), 'utf8');

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
    return { baseUrl: envConf.baseUrl, apiKey: envConf.apiKey, models: envConf.models, timeoutMs: envConf.timeoutMs || 30000, concurrency: envConf.concurrency || 4, modelCosts: {} };
  }
}

function redactText(text, values) {
  let result = text;
  for (const v of values) {
    if (v && v.length >= 8) result = result.split(v).join('[REDACTED]');
  }
  return result;
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

export function createViewerServer({ port = 3001, resultsDir = 'results', history = null } = {}) {
  const runs = new Map();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    if (url.pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_PAGE);
      return;
    }

    if (url.pathname === '/compare') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(COMPARE_PAGE);
      return;
    }

    if (url.pathname === '/api/files') {
      const files = await listResultFiles(resultsDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
      return;
    }

    // Result files that carry a full benchmark aggregate, with light summaries
    // for the dashboard run selector. Skips routing/profile/compare exports.
    if (url.pathname === '/api/runs') {
      const files = await listResultFiles(resultsDir);
      const fileRuns = [];
      for (const f of files) {
        try {
          const data = JSON.parse(await readFile(f, 'utf8'));
          if (data.schema_version === 'routebench.phase0.v1' && data.aggregate?.models) {
            fileRuns.push({ path: f, models: data.models ?? [], finished_at: data.finished_at ?? null, cases: (data.test_cases ?? []).length });
          }
        } catch { /* skip unreadable / non-result files */ }
      }
      fileRuns.sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
      // In-progress runs held in memory, so a page refresh can re-attach to the
      // live progress bar instead of going blank while a benchmark is running.
      const active = [];
      for (const [id, r] of runs) if (r.status === 'running') active.push({ run_id: id, progress: r.progress, models: r.models ?? [] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runs: fileRuns, active }));
      return;
    }

    // Fully-shaped dashboard payload built from one result file, auto-enriched
    // with results/agentic-results.json when present.
    if (url.pathname === '/api/dashboard') {
      const filePath = url.searchParams.get('path');
      try {
        let agenticRows = null;
        try {
          const agentic = JSON.parse(await readFile(join(resultsDir, 'agentic-results.json'), 'utf8'));
          agenticRows = Array.isArray(agentic) ? agentic : (agentic.rows ?? null);
        } catch { /* no agentic results — optional */ }
        // Special "all models" view: merge every result file into one board.
        if (filePath === '__all__') {
          const files = await listResultFiles(resultsDir);
          const results = [];
          for (const f of files) {
            try {
              const data = JSON.parse(await readFile(f, 'utf8'));
              if (data.schema_version === 'routebench.phase0.v1' && data.aggregate?.models) results.push(data);
            } catch { /* skip unreadable / non-result files */ }
          }
          if (results.length === 0) throw new Error('no runs to merge');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildDashboard(mergeResults(results), agenticRows)));
          return;
        }
        const safe = sanitizePath(filePath, resultsDir);
        const result = JSON.parse(await readFile(safe, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildDashboard(result, agenticRows)));
      } catch (err) {
        const status = err.message.includes('traversal') || err.message.includes('required') ? 403 : 404;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
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
      const body = await readBody(req);
      const conf = await tryLoadConfig();
      const baseUrl = (typeof body.base_url === 'string' && body.base_url.trim()) ? body.base_url.trim() : conf.baseUrl;
      const apiKey = (typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : conf.apiKey;
      if (!baseUrl || !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'endpoint not configured — enter URL and API key above, or set them in routebench.config.json' }));
        return;
      }
      try {
        const client = createModelsClient({ baseUrl, apiKey, timeoutMs: conf.timeoutMs });
        const discovery = await client();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(discovery));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Compare model outputs side by side. Two shapes:
    //  - single-turn:  { models:[], system, prompt }
    //  - multi-turn :  { requests:[{ model, messages:[{role,content}] }] }  (each
    //    model carries its own conversation, since their replies differ)
    if (url.pathname === '/api/chat-compare' && req.method === 'POST') {
      const body = await readBody(req);
      const conf = await tryLoadConfig();
      const baseUrl = (typeof body.base_url === 'string' && body.base_url.trim()) ? body.base_url.trim() : conf.baseUrl;
      const apiKey = (typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : (conf.apiKey || '');
      if (!baseUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no endpoint configured — set a base URL' }));
        return;
      }

      let jobs;
      if (Array.isArray(body.requests)) {
        jobs = body.requests
          .filter((r) => r && typeof r.model === 'string' && Array.isArray(r.messages))
          .slice(0, 6)
          .map((r) => ({ model: r.model, messages: r.messages }));
      } else {
        const models = Array.isArray(body.models) ? body.models.map(String).filter(Boolean).slice(0, 6) : [];
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const system = (typeof body.system === 'string' && body.system.trim()) ? body.system : 'You are a helpful assistant.';
        if (models.length && prompt.trim()) {
          const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
          jobs = models.map((model) => ({ model, messages }));
        }
      }
      if (!jobs || jobs.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'at least 1 model and a prompt (or requests[]) are required' }));
        return;
      }

      const client = createChatClient({ baseUrl, apiKey, timeoutMs: conf.timeoutMs });
      const results = await Promise.all(jobs.map(async ({ model, messages }) => {
        const start = Date.now();
        try {
          const r = await client({ model, messages });
          return { model, output: r.output ?? '', usage: r.usage ?? null, latency_ms: Date.now() - start };
        } catch (err) {
          return { model, error: err.message ?? 'request failed', latency_ms: Date.now() - start };
        }
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
      return;
    }

    if (url.pathname === '/api/run') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const models = Array.isArray(body.models) ? body.models.map(String).filter(Boolean) : [];
        const benchmarkPath = typeof body.benchmark === 'string' && body.benchmark ? body.benchmark : 'benchmarks/basics.json';

        if (models.length < 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'at least 1 model required' }));
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

        const bodyBaseUrl = (typeof body.base_url === 'string' && body.base_url.trim()) ? body.base_url.trim() : null;
        const bodyApiKey = (typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : null;

        // Optional guardrail: cap the number of cases per model for this run.
        const maxCases = Number(body.max_test_cases);
        const cases = Number.isFinite(maxCases) && maxCases > 0
          ? benchmarkData.cases.slice(0, Math.floor(maxCases))
          : benchmarkData.cases;
        const repeats = Math.max(1, Math.floor(Number(body.repeats)) || 1);

        const runId = Date.now().toString();
        const totalCases = models.length * cases.length;
        const outputPath = `${resultsDir}/run-${runId}.json`.replace(/\\/g, '/');
        runs.set(runId, { status: 'running', progress: { done: 0, total: totalCases }, result_path: null, error: null, models });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ run_id: runId, total_cases: totalCases, cases_per_pack: cases.length, models }));

        (async () => {
          const run = runs.get(runId);
          try {
            const conf = await tryLoadConfig();
            const baseUrl = bodyBaseUrl || conf.baseUrl;
            const apiKey = bodyApiKey || conf.apiKey;
            if (!baseUrl || !apiKey) throw new Error('endpoint not configured — enter URL and API key in the Run panel');
            const client = createOpenAICompatibleClient({ baseUrl, apiKey, timeoutMs: conf.timeoutMs });
            const result = await runBenchmark({
              models,
              cases,
              client,
              modelCosts: conf.modelCosts || {},
              concurrency: conf.concurrency || 4,
              repeats,
              onProgress(done, total) { if (run) run.progress = { done, total }; },
            });
            await mkdir(resultsDir, { recursive: true });
            const redactValues = [apiKey, conf.apiKey].filter(Boolean);
            await writeFile(outputPath, redactText(`${JSON.stringify(result, null, 2)}\n`, redactValues), 'utf8');
            if (run) { run.status = 'done'; run.result_path = outputPath; }
            if (history) {
              try {
                history.save(resultToHistoryEntry(result, { run_id: runId, result_path: outputPath, benchmark: benchmarkPath }));
              } catch { /* history save failure must not break the run */ }
            }
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

    if (url.pathname === '/api/history') {
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (history && id) history.remove(id);
        res.writeHead(204); res.end();
        return;
      }
      const runs = history ? history.list(200) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runs }));
      return;
    }

    if (url.pathname === '/api/export') {
      const filePath = url.searchParams.get('path');
      const format = url.searchParams.get('format');
      try {
        const safe = sanitizePath(filePath, resultsDir);
        const result = JSON.parse(await readFile(safe, 'utf8'));
        if (format === 'report') {
          const md = renderMarkdownReport(result);
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
          res.end(md);
        } else if (format === 'routing') {
          const routing = renderRouteExport(result, { baseUrl: '' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(`${JSON.stringify(routing, null, 2)}\n`);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `unknown export format "${format}". Supported: report, routing` }));
        }
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
