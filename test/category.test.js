import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { aggregateByCategory, recommendByCategory } from '../src/scoring.js';
import { runBenchmark } from '../src/runner.js';
import { renderRouteExport } from '../src/routeExport.js';
import { renderMarkdownReport } from '../src/report.js';

function rows() {
  return [
    { model: 'a', category: 'json', score: 100, status: 'completed', latency_ms: 100 },
    { model: 'a', category: 'json', score: 80, status: 'completed', latency_ms: 100 },
    { model: 'a', category: 'code', score: 40, status: 'completed', latency_ms: 200 },
    { model: 'b', category: 'json', score: 50, status: 'completed', latency_ms: 50 },
    { model: 'b', category: 'code', score: 90, status: 'completed', latency_ms: 60 },
    { model: 'b', category: 'code', score: 90, status: 'completed', latency_ms: 60 },
  ];
}

test('aggregateByCategory groups by category then model', () => {
  const agg = aggregateByCategory(rows());
  assert.ok(agg.json);
  assert.ok(agg.code);
  assert.equal(agg.json.models.a.avg_score, 90);
  assert.equal(agg.json.models.b.avg_score, 50);
  assert.equal(agg.code.models.b.avg_score, 90);
  assert.equal(agg.code.models.a.avg_score, 40);
});

test('recommendByCategory picks best model per category', () => {
  const rules = recommendByCategory(aggregateByCategory(rows()));
  const byCat = Object.fromEntries(rules.map((r) => [r.category, r]));
  assert.equal(byCat.json.primary_model, 'a');
  assert.deepEqual(byCat.json.fallback_models, ['b']);
  assert.equal(byCat.code.primary_model, 'b');
  assert.deepEqual(byCat.code.fallback_models, ['a']);
});

test('recommendByCategory different categories can route to different models', () => {
  const rules = recommendByCategory(aggregateByCategory(rows()));
  const primaries = new Set(rules.map((r) => r.primary_model));
  assert.ok(primaries.size > 1, 'per-category routing should not collapse to a single model');
});

test('recommendByCategory rules are sorted by category name', () => {
  const rules = recommendByCategory(aggregateByCategory(rows()));
  assert.deepEqual(rules.map((r) => r.category), ['code', 'json']);
});

test('runBenchmark includes category_aggregate and category_routing', async () => {
  const cases = [
    { id: 'c1', name: 'j', scoring: 'exact', expected: { text: 'x' }, metadata: { category: 'json' } },
    { id: 'c2', name: 'k', scoring: 'exact', expected: { text: 'y' }, metadata: { category: 'code' } },
  ];
  const client = async ({ model, testCase }) => ({ output: model === 'good' ? testCase.expected.text : 'wrong', usage: null });
  const result = await runBenchmark({ models: ['good', 'bad'], cases, client, now: () => 1000 });
  assert.ok(result.category_aggregate.json);
  assert.ok(result.category_aggregate.code);
  assert.ok(Array.isArray(result.category_routing));
  const cats = result.category_routing.map((r) => r.category).sort();
  assert.deepEqual(cats, ['code', 'json']);
  for (const rule of result.category_routing) {
    assert.equal(rule.primary_model, 'good');
  }
});

test('runBenchmark parallel execution preserves stable result order', async () => {
  const cases = [
    { id: 'c1', name: 'a', scoring: 'exact', expected: { text: '1' }, metadata: { category: 'x' } },
    { id: 'c2', name: 'b', scoring: 'exact', expected: { text: '2' }, metadata: { category: 'x' } },
    { id: 'c3', name: 'c', scoring: 'exact', expected: { text: '3' }, metadata: { category: 'x' } },
  ];
  // client resolves out of order via random-ish delays, but results must stay model-major, case-order
  const client = async ({ testCase }) => {
    await new Promise((r) => setTimeout(r, (4 - Number(testCase.expected.text)) * 5));
    return { output: testCase.expected.text, usage: null };
  };
  const result = await runBenchmark({ models: ['m1', 'm2'], cases, client, concurrency: 8 });
  assert.equal(result.results.length, 6);
  assert.deepEqual(
    result.results.map((r) => `${r.model}:${r.test_case_id}`),
    ['m1:c1', 'm1:c2', 'm1:c3', 'm2:c1', 'm2:c2', 'm2:c3'],
  );
});

test('runBenchmark concurrency=1 matches parallel result content', async () => {
  const cases = [
    { id: 'c1', name: 'a', scoring: 'exact', expected: { text: '1' }, metadata: { category: 'x' } },
    { id: 'c2', name: 'b', scoring: 'exact', expected: { text: '2' }, metadata: { category: 'x' } },
  ];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  const seq = await runBenchmark({ models: ['m'], cases, client, now: () => 1000, concurrency: 1 });
  const par = await runBenchmark({ models: ['m'], cases, client, now: () => 1000, concurrency: 8 });
  assert.deepEqual(
    seq.results.map((r) => [r.test_case_id, r.score]),
    par.results.map((r) => [r.test_case_id, r.score]),
  );
});

test('runBenchmark onProgress fires once per task under concurrency', async () => {
  const cases = [
    { id: 'c1', name: 'a', scoring: 'exact', expected: { text: '1' }, metadata: { category: 'x' } },
    { id: 'c2', name: 'b', scoring: 'exact', expected: { text: '2' }, metadata: { category: 'x' } },
  ];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  let last = 0;
  let calls = 0;
  await runBenchmark({
    models: ['m1', 'm2'],
    cases,
    client,
    concurrency: 4,
    onProgress(done, total) { calls += 1; last = done; assert.equal(total, 4); },
  });
  assert.equal(calls, 4);
  assert.equal(last, 4);
});

test('renderRouteExport includes category_rules without api_key', async () => {
  const cases = [
    { id: 'c1', name: 'j', scoring: 'exact', expected: { text: 'x' }, metadata: { category: 'json' } },
    { id: 'c2', name: 'k', scoring: 'exact', expected: { text: 'y' }, metadata: { category: 'code' } },
  ];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  const result = await runBenchmark({ models: ['m1', 'm2'], cases, client });
  const exported = renderRouteExport(result, { baseUrl: 'http://x/v1' });
  assert.ok(Array.isArray(exported.category_rules));
  assert.equal(exported.category_rules.length, 2);
  assert.ok(exported.category_rules[0].category);
  assert.ok('primary_model' in exported.category_rules[0]);
  assert.ok(!JSON.stringify(exported).includes('api_key'));
});

test('renderMarkdownReport includes Per-Category Routing section', async () => {
  const cases = [
    { id: 'c1', name: 'j', scoring: 'exact', expected: { text: 'x' }, metadata: { category: 'json' } },
  ];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  const result = await runBenchmark({ models: ['m1', 'm2'], cases, client });
  const md = renderMarkdownReport(result);
  assert.ok(md.includes('## Per-Category Routing'));
  assert.ok(md.includes('| Category | Primary |'));
});

test('phase1 benchmark pack has 36 cases across six MVP categories', () => {
  const pack = JSON.parse(readFileSync('benchmarks/phase1.json', 'utf8'));
  assert.equal(pack.cases.length, 36);
  const cats = {};
  for (const c of pack.cases) cats[c.metadata.category] = (cats[c.metadata.category] || 0) + 1;
  assert.deepEqual(Object.keys(cats).sort(), [
    'coding_agent_basic',
    'indonesian_qa',
    'instruction_following_basic',
    'json_compliance',
    'prompt_injection_resistance',
    'summarization_quality',
  ]);
  // every case has a known scoring type and an id
  const validScoring = new Set(['exact', 'json_schema', 'contains', 'prompt_injection']);
  for (const c of pack.cases) {
    assert.ok(c.id, 'case missing id');
    assert.ok(validScoring.has(c.scoring), `bad scoring: ${c.scoring}`);
  }
});
