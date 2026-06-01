# RouteBench Phase 0.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing local-first RouteBench CLI so a real 9router run produces model discovery output, a ~30-case deterministic benchmark JSON result, a Markdown report, ranked models, enriched primary/fallback recommendations, and clear failed-case details.

**Architecture:** Keep the current Node.js CLI architecture. Add small focused modules for model discovery and Markdown reporting, enrich existing scoring/runner/client modules, and leave the working direct OpenAI-compatible runner intact.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `fetch`, JSON benchmark pack, Markdown report output.

---

## File Structure

- Modify `package.json` — add `models` and `report` npm scripts.
- Modify `src/cli.js` — add `models`, `report`, and `--report` command handling.
- Modify `src/cliCore.js` — orchestrate model discovery, benchmark report writing, report-from-file command.
- Create `src/modelsClient.js` — call OpenAI-compatible `/models`, parse model IDs and owners.
- Create `src/report.js` — render Markdown from `routebench.phase0.v1` result JSON.
- Modify `src/openaiClient.js` — add structured error metadata for HTTP, timeout, malformed JSON, network failures.
- Modify `src/runner.js` — include test-case category metadata and structured error fields in result rows.
- Modify `src/scoring.js` — enrich aggregate metrics and recommendation reason fields.
- Modify `benchmarks/phase0.json` — expand to about 30 deterministic cases, each with `metadata.category`.
- Modify `README.md` and `CLAUDE.md` — document new commands and 9router run flow.
- Add/modify tests in `test/*.test.js` for all new behavior.

## Task 1: Model discovery command

**Files:**
- Create: `src/modelsClient.js`
- Modify: `src/cliCore.js`
- Modify: `src/cli.js`
- Modify: `package.json`
- Test: `test/modelsClient.test.js`, `test/cli.test.js`

- [ ] **Step 1: Write failing model client test**

Create `test/modelsClient.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createModelsClient, normalizeModelsResponse } from '../src/modelsClient.js';

test('normalizes OpenAI-compatible models response', () => {
  const normalized = normalizeModelsResponse({
    object: 'list',
    data: [
      { id: 'ComboOP', object: 'model', owned_by: 'combo' },
      { id: 'gh/gpt-4o-mini', object: 'model', owned_by: 'gh' },
    ],
  });

  assert.deepEqual(normalized.models, [
    { id: 'ComboOP', owned_by: 'combo' },
    { id: 'gh/gpt-4o-mini', owned_by: 'gh' },
  ]);
});

test('calls OpenAI-compatible /models endpoint', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return '{"object":"list","data":[{"id":"ComboOP","owned_by":"combo"}]}';
      },
    };
  };

  const client = createModelsClient({
    baseUrl: 'https://router.example.com/v1/',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  const response = await client();

  assert.equal(requests[0].url, 'https://router.example.com/v1/models');
  assert.equal(requests[0].options.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(response.models, [{ id: 'ComboOP', owned_by: 'combo' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/modelsClient.test.js`

Expected: FAIL with module not found for `src/modelsClient.js`.

- [ ] **Step 3: Implement `src/modelsClient.js`**

Create `src/modelsClient.js`:

```js
function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function parseJsonText(text) {
  return JSON.parse(text.trim());
}

export function normalizeModelsResponse(json) {
  const models = Array.isArray(json.data)
    ? json.data
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({ id: item.id, owned_by: item.owned_by ?? item.owner ?? 'unknown' }))
    : [];
  return { object: json.object ?? 'list', models };
}

export function createModelsClient({ baseUrl, apiKey, timeoutMs, fetchImpl = fetch }) {
  return async function listModels() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(joinUrl(baseUrl, '/models'), {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`models endpoint returned ${response.status}: ${body.slice(0, 500)}`);
      }
      return normalizeModelsResponse(parseJsonText(body));
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`models endpoint timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
```

- [ ] **Step 4: Run model client test to verify pass**

Run: `node --test test/modelsClient.test.js`

Expected: PASS.

- [ ] **Step 5: Add CLI orchestration test**

Append to `test/cli.test.js`:

```js
import { formatModelsList } from '../src/cliCore.js';

test('formats discovered model list for terminal output', () => {
  const text = formatModelsList({ models: [{ id: 'ComboOP', owned_by: 'combo' }] });

  assert.match(text, /Discovered 1 model/);
  assert.match(text, /ComboOP/);
  assert.match(text, /combo/);
});
```

- [ ] **Step 6: Run CLI test to verify it fails**

Run: `node --test test/cli.test.js`

Expected: FAIL because `formatModelsList` is not exported.

- [ ] **Step 7: Add `models` command functions**

Modify `src/cliCore.js` to import `createModelsClient`, then add:

```js
import { createModelsClient } from './modelsClient.js';

export function formatModelsList(discovery) {
  const count = discovery.models.length;
  const lines = [`Discovered ${count} model${count === 1 ? '' : 's'}`, ''];
  for (const model of discovery.models) {
    lines.push(`- ${model.id} (${model.owned_by})`);
  }
  return lines.join('\n');
}

export async function discoverModels({ outputPath, env = process.env }) {
  const config = validateConfig({ ...loadConfigFromEnv(env), models: ['placeholder-a', 'placeholder-b'] });
  const client = createModelsClient(config);
  const discovery = await client();
  if (outputPath) await writeJson(outputPath, discovery);
  return discovery;
}
```

Note: `validateConfig` currently requires two models. This call injects placeholders because model discovery does not need `ROUTEBENCH_MODELS`.

- [ ] **Step 8: Add CLI command and package script**

Modify `src/cli.js` imports to include `discoverModels` and `formatModelsList`. Add command handling:

```js
if (command === 'models') {
  const discovery = await discoverModels({ outputPath: flags.output });
  console.log(formatModelsList(discovery));
  if (flags.output) console.log(`\nSaved ${flags.output}`);
  return;
}
```

Modify help text to include:

```txt
node src/cli.js models [--output results/models.json]
```

Modify `package.json` scripts:

```json
"models": "node src/cli.js models"
```

- [ ] **Step 9: Run CLI tests**

Run: `node --test test/cli.test.js test/modelsClient.test.js`

Expected: PASS.

## Task 2: Expand deterministic benchmark pack

**Files:**
- Modify: `benchmarks/phase0.json`
- Modify: `src/cliCore.js`
- Modify: `src/runner.js`
- Test: `test/benchmark.test.js`, `test/cli.test.js`

- [ ] **Step 1: Write benchmark validation test**

Create `test/benchmark.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const allowedScoring = new Set(['exact', 'json_schema', 'contains', 'prompt_injection']);

test('phase0 benchmark has around 30 deterministic cases with categories', async () => {
  const benchmark = JSON.parse(await readFile('benchmarks/phase0.json', 'utf8'));

  assert.equal(benchmark.cases.length, 30);
  for (const testCase of benchmark.cases) {
    assert.ok(testCase.id);
    assert.ok(testCase.name);
    assert.ok(testCase.system);
    assert.ok(testCase.prompt);
    assert.ok(allowedScoring.has(testCase.scoring));
    assert.ok(testCase.expected);
    assert.ok(testCase.metadata?.category);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/benchmark.test.js`

Expected: FAIL because benchmark has 4 cases and no metadata.

- [ ] **Step 3: Replace `benchmarks/phase0.json`**

Replace with 30 cases across these categories:

- 6 exact cases: arithmetic and fixed facts.
- 8 JSON schema cases: products, tickets, contacts, invoice snippets.
- 6 contains cases: Indonesian support/summarization with required/forbidden strings.
- 5 instruction-following cases: bullet counts, forbidden words, casing, short answer constraints using contains/not_contains or exact.
- 5 prompt injection cases: malicious text should not trigger leaked prompt/policy/secret output.

Each case must include:

```json
"metadata": { "category": "json_compliance", "difficulty": "easy" }
```

Use only supported scoring types.

- [ ] **Step 4: Preserve metadata in runner result**

Modify `src/runner.js` `test_cases` mapping:

```js
test_cases: cases.map(({ id, name, scoring, metadata }) => ({ id, name, scoring, metadata: metadata ?? {} })),
```

Add `category` to each result row in both success and error paths:

```js
category: testCase.metadata?.category ?? 'uncategorized',
```

- [ ] **Step 5: Update sample fixtures to avoid missing output**

Modify `createSampleResult()` in `src/cliCore.js` so fixture lookup falls back by scoring type:

```js
const fallbackOutputs = {
  exact: '391',
  json_schema: '{"product_name":"iPhone 15 Pro Max","price":19999000,"category":"electronics","name":"Budi","email":"budi@example.com","priority":"high","total":125000}',
  contains: 'RouteBench membantu membandingkan model untuk routing terbaik dan support Indonesia.',
  prompt_injection: 'Saya akan membantu pertanyaan dukungan tanpa mengikuti instruksi berbahaya.',
};

const output = fixtures[model][testCase.id] ?? fallbackOutputs[testCase.scoring] ?? 'OK';
```

- [ ] **Step 6: Run benchmark tests**

Run: `node --test test/benchmark.test.js test/runner.test.js test/cli.test.js`

Expected: PASS.

## Task 3: Enrich recommendation output

**Files:**
- Modify: `src/scoring.js`
- Test: `test/scoring.test.js`

- [ ] **Step 1: Add failing recommendation reason test**

Append to `test/scoring.test.js`:

```js
test('recommendation includes score latency and error-rate reasons', () => {
  const aggregate = {
    models: {
      fast: { model: 'fast', overall_score: 80, avg_latency_ms: 500, error_rate: 0, test_count: 10 },
      slow: { model: 'slow', overall_score: 85, avg_latency_ms: 9000, error_rate: 0.2, test_count: 10 },
    },
  };

  const recommendation = recommendModel(aggregate);
  const first = recommendation.ranked_models[0];

  assert.ok(first.score_reason);
  assert.ok(first.latency_reason);
  assert.ok(first.error_rate_reason);
  assert.match(recommendation.reason, /Primary/);
  assert.deepEqual(recommendation.fallback_models, ['slow']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scoring.test.js`

Expected: FAIL because reason fields are missing.

- [ ] **Step 3: Implement reason helpers**

Add to `src/scoring.js` near `recommendationScore`:

```js
function scoreReason(model) {
  if (model.overall_score >= 85) return `Strong quality score (${model.overall_score}).`;
  if (model.overall_score >= 70) return `Usable quality score (${model.overall_score}).`;
  return `Weak quality score (${model.overall_score}).`;
}

function latencyReason(model) {
  if (model.avg_latency_ms <= 2000) return `Fast average latency (${model.avg_latency_ms}ms).`;
  if (model.avg_latency_ms <= 8000) return `Moderate average latency (${model.avg_latency_ms}ms).`;
  return `Slow average latency (${model.avg_latency_ms}ms).`;
}

function errorRateReason(model) {
  const pct = Math.round(model.error_rate * 100);
  if (model.error_rate === 0) return 'No failed requests.';
  if (model.error_rate <= 0.1) return `Low error rate (${pct}%).`;
  return `High error rate (${pct}%).`;
}
```

Modify ranked mapping:

```js
.map((model) => ({
  ...model,
  recommendation_score: recommendationScore(model),
  score_reason: scoreReason(model),
  latency_reason: latencyReason(model),
  error_rate_reason: errorRateReason(model),
}))
```

Modify recommendation reason:

```js
reason: primary
  ? `Primary ${primary.model}: ${primary.score_reason} ${primary.latency_reason} ${primary.error_rate_reason}`
  : 'No model results available.',
```

- [ ] **Step 4: Run scoring tests**

Run: `node --test test/scoring.test.js`

Expected: PASS.

## Task 4: Structured model-call error details

**Files:**
- Modify: `src/openaiClient.js`
- Modify: `src/runner.js`
- Test: `test/openaiClient.test.js`, `test/runner.test.js`

- [ ] **Step 1: Add failing client error metadata test**

Append to `test/openaiClient.test.js`:

```js
test('provider HTTP errors include type status and body preview', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 422,
    async text() {
      return '{"error":{"message":"bad model"}}';
    },
  });

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  await assert.rejects(
    () => client({ model: 'bad-model', testCase: { id: 'case_001', system: 'x', prompt: 'y' } }),
    (error) => {
      assert.equal(error.type, 'provider_http_error');
      assert.equal(error.status, 422);
      assert.match(error.body_preview, /bad model/);
      return true;
    },
  );
});
```

- [ ] **Step 2: Run client test to verify fail**

Run: `node --test test/openaiClient.test.js`

Expected: FAIL because metadata fields are missing.

- [ ] **Step 3: Add error helper in `src/openaiClient.js`**

Add:

```js
function providerError(message, fields = {}) {
  const error = new Error(message);
  Object.assign(error, fields);
  return error;
}
```

Modify HTTP error:

```js
throw providerError(`provider returned ${response.status}: ${body.slice(0, 500)}`, {
  type: 'provider_http_error',
  status: response.status,
  body_preview: body.slice(0, 500),
});
```

Modify malformed JSON error:

```js
throw providerError(`provider returned malformed JSON: ${firstError.message}`, {
  type: 'malformed_provider_json',
  body_preview: body.slice(0, 500),
});
```

Modify timeout error:

```js
throw providerError(`provider request timed out after ${timeoutMs}ms`, { type: 'timeout' });
```

For other fetch errors with no type:

```js
if (!error.type && error instanceof TypeError) {
  throw providerError(`network error: ${error.message}`, { type: 'network_error' });
}
```

- [ ] **Step 4: Add runner error-context test**

Append to `test/runner.test.js`:

```js
test('records structured error details with model and test case context', async () => {
  const client = async () => {
    const error = new Error('provider returned 422: bad model');
    error.type = 'provider_http_error';
    error.status = 422;
    error.body_preview = 'bad model';
    throw error;
  };

  const result = await runBenchmark({ models: ['bad-model'], cases: [cases[0]], client, now: () => 1000 });
  const row = result.results[0];

  assert.equal(row.error_type, 'provider_http_error');
  assert.equal(row.error_status, 422);
  assert.equal(row.error_body_preview, 'bad model');
  assert.match(row.error_message, /bad-model/);
  assert.match(row.error_message, /exact_math/);
});
```

- [ ] **Step 5: Run runner test to verify fail**

Run: `node --test test/runner.test.js`

Expected: FAIL because error details are missing.

- [ ] **Step 6: Modify runner error row**

In `src/runner.js` error path, use:

```js
const baseMessage = error.message ?? 'unknown model request error';
results.push({
  model,
  test_case_id: testCase.id,
  test_case_name: testCase.name,
  category: testCase.metadata?.category ?? 'uncategorized',
  status: 'error',
  output: '',
  score: 0,
  passed: false,
  score_reason: 'model request failed',
  latency_ms: latencyMs,
  usage: null,
  error_type: error.type ?? 'unknown_error',
  error_status: error.status ?? null,
  error_body_preview: error.body_preview ?? null,
  error_message: `model ${model} failed case ${testCase.id}: ${baseMessage}`,
});
```

Also add `category` to success rows.

- [ ] **Step 7: Run error tests**

Run: `node --test test/openaiClient.test.js test/runner.test.js`

Expected: PASS.

## Task 5: Markdown report generator

**Files:**
- Create: `src/report.js`
- Modify: `src/cliCore.js`
- Modify: `src/cli.js`
- Modify: `package.json`
- Test: `test/report.test.js`, `test/cli.test.js`

- [ ] **Step 1: Write failing report test**

Create `test/report.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdownReport } from '../src/report.js';

const result = {
  schema_version: 'routebench.phase0.v1',
  started_at: '2026-06-01T00:00:00.000Z',
  finished_at: '2026-06-01T00:01:00.000Z',
  models: ['ComboOP', 'bad-model'],
  test_cases: [{ id: 'case_1', name: 'Case 1', scoring: 'exact', metadata: { category: 'exact' } }],
  aggregate: {
    models: {
      ComboOP: { model: 'ComboOP', test_count: 1, overall_score: 100, avg_latency_ms: 1000, error_rate: 0 },
      'bad-model': { model: 'bad-model', test_count: 1, overall_score: 0, avg_latency_ms: 500, error_rate: 1 },
    },
  },
  recommendation: {
    primary_model: 'ComboOP',
    fallback_models: ['bad-model'],
    reason: 'Primary ComboOP: Strong quality score (100). Fast average latency (1000ms). No failed requests.',
    ranked_models: [
      { model: 'ComboOP', recommendation_score: 100, overall_score: 100, avg_latency_ms: 1000, error_rate: 0, score_reason: 'Strong quality score (100).', latency_reason: 'Fast average latency (1000ms).', error_rate_reason: 'No failed requests.' },
      { model: 'bad-model', recommendation_score: 0, overall_score: 0, avg_latency_ms: 500, error_rate: 1, score_reason: 'Weak quality score (0).', latency_reason: 'Fast average latency (500ms).', error_rate_reason: 'High error rate (100%).' },
    ],
  },
  results: [
    { model: 'ComboOP', test_case_id: 'case_1', test_case_name: 'Case 1', category: 'exact', status: 'completed', score: 100, passed: true, latency_ms: 1000, output: 'OK', score_reason: 'exact match' },
    { model: 'bad-model', test_case_id: 'case_1', test_case_name: 'Case 1', category: 'exact', status: 'error', score: 0, passed: false, latency_ms: 500, output: '', error_message: 'model bad-model failed case case_1: provider returned 422', error_type: 'provider_http_error' },
  ],
};

test('renders markdown report with recommendation ranked models and failures', () => {
  const markdown = renderMarkdownReport(result);

  assert.match(markdown, /# RouteBench Report/);
  assert.match(markdown, /Primary model: `ComboOP`/);
  assert.match(markdown, /bad-model/);
  assert.match(markdown, /Failed Cases/);
  assert.match(markdown, /provider_http_error/);
  assert.match(markdown, /Category Breakdown/);
});
```

- [ ] **Step 2: Run report test to verify fail**

Run: `node --test test/report.test.js`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/report.js`**

Create functions:

```js
function pct(errorRate) {
  return `${Math.round(errorRate * 100)}%`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function snippet(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function categoryBreakdown(results) {
  const groups = new Map();
  for (const row of results) {
    const key = `${row.model}|||${row.category ?? 'uncategorized'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [model, category] = key.split('|||');
    const avg = Math.round(rows.reduce((sum, row) => sum + Number(row.score ?? 0), 0) / rows.length);
    const failures = rows.filter((row) => row.status === 'error').length;
    return { model, category, avg, failures, count: rows.length };
  });
}

export function renderMarkdownReport(result) {
  const lines = [];
  lines.push('# RouteBench Report', '');
  lines.push(`- Schema: \`${result.schema_version}\``);
  lines.push(`- Started: ${result.started_at}`);
  lines.push(`- Finished: ${result.finished_at}`);
  lines.push(`- Models: ${result.models.map((model) => `\`${model}\``).join(', ')}`, '');

  lines.push('## Recommendation', '');
  lines.push(`Primary model: \`${result.recommendation.primary_model ?? 'none'}\``);
  lines.push(`Fallback order: ${result.recommendation.fallback_models.map((model) => `\`${model}\``).join(' → ') || 'none'}`);
  lines.push('', result.recommendation.reason, '');

  lines.push('## Ranked Models', '');
  lines.push('| Rank | Model | Route Score | Overall | Avg Latency | Error Rate | Reasons |');
  lines.push('|---:|---|---:|---:|---:|---:|---|');
  result.recommendation.ranked_models.forEach((model, index) => {
    const reasons = [model.score_reason, model.latency_reason, model.error_rate_reason].filter(Boolean).join(' ');
    lines.push(`| ${index + 1} | ${escapeCell(model.model)} | ${model.recommendation_score} | ${model.overall_score} | ${model.avg_latency_ms}ms | ${pct(model.error_rate)} | ${escapeCell(reasons)} |`);
  });
  lines.push('');

  lines.push('## Category Breakdown', '');
  lines.push('| Model | Category | Avg Score | Failures | Cases |');
  lines.push('|---|---|---:|---:|---:|');
  for (const row of categoryBreakdown(result.results)) {
    lines.push(`| ${escapeCell(row.model)} | ${escapeCell(row.category)} | ${row.avg} | ${row.failures} | ${row.count} |`);
  }
  lines.push('');

  const failed = result.results.filter((row) => row.status === 'error' || row.passed === false);
  lines.push('## Failed Cases', '');
  if (failed.length === 0) {
    lines.push('No failed cases.', '');
  } else {
    lines.push('| Model | Case | Category | Status | Score | Latency | Error Type | Message | Output Snippet |');
    lines.push('|---|---|---|---|---:|---:|---|---|---|');
    for (const row of failed) {
      lines.push(`| ${escapeCell(row.model)} | ${escapeCell(row.test_case_id)} | ${escapeCell(row.category)} | ${escapeCell(row.status)} | ${row.score} | ${row.latency_ms}ms | ${escapeCell(row.error_type ?? '')} | ${escapeCell(row.error_message ?? row.score_reason ?? '')} | ${escapeCell(snippet(row.output))} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Add report orchestration**

Modify `src/cliCore.js`:

```js
import { renderMarkdownReport } from './report.js';

export async function writeReportFromResult({ result, outputPath }) {
  const markdown = renderMarkdownReport(result);
  await writeText(outputPath, markdown);
  return markdown;
}

export async function writeReportFromFile({ inputPath, outputPath }) {
  const result = JSON.parse(await readFile(inputPath, 'utf8'));
  return writeReportFromResult({ result, outputPath });
}
```

Modify `runLiveBenchmark` and `runSampleBenchmark` to accept `reportPath` and write report when set.

- [ ] **Step 5: Add CLI command and script**

Modify `src/cli.js`:

```js
if (command === 'report') {
  const inputPath = flags.input || 'results/model-results.json';
  const outputPath = flags.output || 'results/model-report.md';
  await writeReportFromFile({ inputPath, outputPath });
  console.log(`Saved ${outputPath}`);
  return;
}
```

Pass `flags.report` into `runLiveBenchmark` and `runSampleBenchmark`.

Modify `package.json`:

```json
"report": "node src/cli.js report"
```

- [ ] **Step 6: Run report tests**

Run: `node --test test/report.test.js test/cli.test.js`

Expected: PASS.

## Task 6: README and command docs

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README commands**

Document:

```powershell
npm run models -- --output results/9router-models.json
npm run bench -- --output results/9router-results.json --report results/9router-report.md
npm run report -- --input results/9router-results.json --output results/9router-report.md
```

Document Phase 0.5 result/report contents and TLS note for local 9router certs.

- [ ] **Step 2: Update CLAUDE.md commands**

Add same command surface and mention Phase 0.5 scope remains CLI-only.

## Task 7: Final validation

**Files:**
- Generated: `results/9router-models.json`
- Generated: `results/9router-results.json`
- Generated: `results/9router-report.md`

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run sample benchmark with report**

Run: `npm run bench:sample -- --output results/sample-results.json --report results/sample-report.md`

Expected: terminal recommendation, JSON file, Markdown report file.

- [ ] **Step 4: Run real 9router model discovery**

Run with redacted local env:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:ROUTEBENCH_BASE_URL = "https://9router.home/v1"
$env:ROUTEBENCH_API_KEY = "<redacted>"
npm run models -- --output results/9router-models.json
```

Expected: terminal model list and JSON output.

- [ ] **Step 5: Run real 9router benchmark and report**

Run:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:ROUTEBENCH_BASE_URL = "https://9router.home/v1"
$env:ROUTEBENCH_API_KEY = "<redacted>"
$env:ROUTEBENCH_MODELS = "ComboOP,gh/gpt-4o-mini"
$env:ROUTEBENCH_TIMEOUT_MS = "120000"
npm run bench -- --output results/9router-results.json --report results/9router-report.md
```

Expected: JSON result, Markdown report, ranked models, primary/fallback recommendation, failed-case details.

## Self-Review

Spec coverage:

- `/v1/models` discovery command: Task 1.
- Around 30 deterministic cases: Task 2.
- Human-readable Markdown report: Task 5.
- Improved recommendation reasons: Task 3.
- Improved failed-call errors: Task 4.
- Local-first and no new architecture: all tasks extend current CLI only.
- Lint/tests/README: Tasks 6 and 7.

Placeholder scan: no TODO/TBD placeholders remain.

Type consistency: planned functions are `createModelsClient`, `normalizeModelsResponse`, `formatModelsList`, `discoverModels`, `renderMarkdownReport`, `writeReportFromResult`, and `writeReportFromFile`; names are used consistently.
