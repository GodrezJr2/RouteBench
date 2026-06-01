import test from 'node:test';
import assert from 'node:assert/strict';

import { compareRuns } from '../src/compare.js';
import { renderCompareReport } from '../src/compareReport.js';

function makeResult(model, caseId, status, score, latencyMs, category = 'general') {
  return {
    model,
    test_case_id: caseId,
    test_case_name: caseId,
    category,
    status,
    score,
    passed: status === 'completed',
    score_reason: '',
    latency_ms: latencyMs,
    usage: null,
    estimated_cost_usd: null,
  };
}

function makeRun(models, results, { primaryOverride } = {}) {
  const aggregate = { models: {} };
  for (const m of models) {
    const mResults = results.filter((r) => r.model === m);
    const count = mResults.length;
    const scoreSum = mResults.reduce((s, r) => s + r.score, 0);
    const latSum = mResults.reduce((s, r) => s + r.latency_ms, 0);
    const errorCount = mResults.filter((r) => r.status !== 'completed').length;
    aggregate.models[m] = {
      model: m,
      test_count: count,
      overall_score: count ? Math.round(scoreSum / count) : 0,
      avg_latency_ms: count ? Math.round(latSum / count) : 0,
      error_rate: count ? Number((errorCount / count).toFixed(4)) : 0,
      total_estimated_cost_usd: null,
    };
  }
  const ranked = Object.values(aggregate.models).sort((a, b) => b.overall_score - a.overall_score);
  const primary = primaryOverride ?? ranked[0]?.model ?? null;
  const recommendation = {
    primary_model: primary,
    fallback_models: ranked.filter((m) => m.model !== primary).map((m) => m.model),
    ranked_models: ranked,
  };
  return {
    schema_version: 'routebench.phase0.v1',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:05:00.000Z',
    models,
    test_cases: [],
    results,
    aggregate,
    recommendation,
  };
}

// --- compareRuns tests ---

test('compareRuns returns routebench.compare.v1 schema version', () => {
  const run = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const result = compareRuns(run, run);
  assert.equal(result.schema_version, 'routebench.compare.v1');
});

test('compareRuns includes baseline and candidate metadata', () => {
  const run = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const result = compareRuns(run, run);
  assert.equal(result.baseline.started_at, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(result.baseline.models, ['model-a']);
  assert.equal(result.candidate.started_at, '2026-01-01T00:00:00.000Z');
});

test('compareRuns computes score and latency deltas for shared models', () => {
  const baseline = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 60, 800)]);
  const candidate = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.equal(mc.score_delta, 20);
  assert.equal(mc.latency_delta_ms, -300);
  assert.equal(mc.error_rate_delta, 0);
});

test('compareRuns computes error_rate delta', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
    makeResult('model-a', 'case-2', 'completed', 100, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
    makeResult('model-a', 'case-2', 'provider_error', 0, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.equal(mc.error_rate_delta, 0.5);
});

test('compareRuns identifies new failures', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
    makeResult('model-a', 'case-2', 'completed', 100, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
    makeResult('model-a', 'case-2', 'provider_error', 0, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.deepEqual(mc.new_failures, ['case-2']);
  assert.deepEqual(mc.recovered, []);
});

test('compareRuns identifies recovered cases', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'provider_error', 0, 500),
    makeResult('model-a', 'case-2', 'completed', 100, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
    makeResult('model-a', 'case-2', 'completed', 100, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.deepEqual(mc.new_failures, []);
  assert.deepEqual(mc.recovered, ['case-1']);
});

test('compareRuns tracks status changes between error types', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'provider_error', 0, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'model_failure', 0, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.equal(mc.status_changes.length, 1);
  assert.equal(mc.status_changes[0].case_id, 'case-1');
  assert.equal(mc.status_changes[0].baseline_status, 'provider_error');
  assert.equal(mc.status_changes[0].candidate_status, 'model_failure');
  assert.deepEqual(mc.new_failures, []);
  assert.deepEqual(mc.recovered, []);
});

test('compareRuns handles model present only in candidate', () => {
  const baseline = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const candidate = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 80, 500),
    makeResult('model-b', 'case-1', 'completed', 70, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  const mb = result.model_comparisons.find((m) => m.model === 'model-b');
  assert.equal(mb.in_baseline, false);
  assert.equal(mb.in_candidate, true);
  assert.equal(mb.score_delta, null);
  assert.equal(mb.latency_delta_ms, null);
  assert.equal(mb.error_rate_delta, null);
});

test('compareRuns handles model present only in baseline', () => {
  const baseline = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 80, 500),
    makeResult('model-b', 'case-1', 'completed', 70, 500),
  ]);
  const candidate = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const result = compareRuns(baseline, candidate);
  const mb = result.model_comparisons.find((m) => m.model === 'model-b');
  assert.equal(mb.in_baseline, true);
  assert.equal(mb.in_candidate, false);
  assert.equal(mb.score_delta, null);
});

test('compareRuns computes category score changes', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 60, 500, 'json-compliance'),
    makeResult('model-a', 'case-2', 'completed', 80, 500, 'instruction-following'),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 80, 500, 'json-compliance'),
    makeResult('model-a', 'case-2', 'completed', 80, 500, 'instruction-following'),
  ]);
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  const jsonCat = mc.category_changes.find((c) => c.category === 'json-compliance');
  assert.equal(jsonCat.baseline_score, 60);
  assert.equal(jsonCat.candidate_score, 80);
  assert.equal(jsonCat.delta, 20);
  const instrCat = mc.category_changes.find((c) => c.category === 'instruction-following');
  assert.equal(instrCat.delta, 0);
});

test('compareRuns detects primary recommendation change', () => {
  const baseline = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 90, 500),
    makeResult('model-b', 'case-1', 'completed', 60, 500),
  ]);
  const candidate = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 60, 500),
    makeResult('model-b', 'case-1', 'completed', 90, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  assert.equal(result.recommendation_change.primary_changed, true);
  assert.equal(result.recommendation_change.baseline_primary, 'model-a');
  assert.equal(result.recommendation_change.candidate_primary, 'model-b');
});

test('compareRuns unchanged primary recommendation is false', () => {
  const run = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 90, 500),
    makeResult('model-b', 'case-1', 'completed', 60, 500),
  ]);
  const result = compareRuns(run, run);
  assert.equal(result.recommendation_change.primary_changed, false);
  assert.equal(result.recommendation_change.fallback_changed, false);
});

test('compareRuns detects fallback chain change', () => {
  const baseline = makeRun(
    ['model-a', 'model-b', 'model-c'],
    [
      makeResult('model-a', 'case-1', 'completed', 90, 500),
      makeResult('model-b', 'case-1', 'completed', 70, 500),
      makeResult('model-c', 'case-1', 'completed', 60, 500),
    ],
  );
  const candidate = makeRun(
    ['model-a', 'model-b', 'model-c'],
    [
      makeResult('model-a', 'case-1', 'completed', 90, 500),
      makeResult('model-b', 'case-1', 'completed', 50, 500),
      makeResult('model-c', 'case-1', 'completed', 75, 500),
    ],
  );
  const result = compareRuns(baseline, candidate);
  assert.equal(result.recommendation_change.primary_changed, false);
  assert.equal(result.recommendation_change.fallback_changed, true);
});

test('compareRuns summary counts regressions and improvements', () => {
  const baseline = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 80, 500),
    makeResult('model-b', 'case-1', 'completed', 60, 500),
  ]);
  const candidate = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 70, 500),
    makeResult('model-b', 'case-1', 'completed', 80, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  assert.equal(result.summary.total_regressions, 1);
  assert.equal(result.summary.total_improvements, 1);
  assert.equal(result.summary.new_failure_count, 0);
  assert.equal(result.summary.recovered_count, 0);
});

test('compareRuns summary counts new failures and recovered', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
    makeResult('model-a', 'case-2', 'provider_error', 0, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'provider_error', 0, 500),
    makeResult('model-a', 'case-2', 'completed', 100, 500),
  ]);
  const result = compareRuns(baseline, candidate);
  assert.equal(result.summary.new_failure_count, 1);
  assert.equal(result.summary.recovered_count, 1);
});

test('compareRuns cost_delta_usd is null when costs not available', () => {
  const run = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const result = compareRuns(run, run);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.equal(mc.cost_delta_usd, null);
});

test('compareRuns computes cost_delta_usd when both have cost data', () => {
  const baseline = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  baseline.aggregate.models['model-a'].total_estimated_cost_usd = 0.01;
  const candidate = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  candidate.aggregate.models['model-a'].total_estimated_cost_usd = 0.015;
  const result = compareRuns(baseline, candidate);
  const mc = result.model_comparisons.find((m) => m.model === 'model-a');
  assert.ok(Math.abs(mc.cost_delta_usd - 0.005) < 0.0001);
});

// --- renderCompareReport tests ---

test('renderCompareReport returns a markdown string with report heading', () => {
  const run = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const compare = compareRuns(run, run);
  const report = renderCompareReport(compare, { baselinePath: 'results/run1.json', candidatePath: 'results/run2.json' });
  assert.equal(typeof report, 'string');
  assert.match(report, /# RouteBench Compare Report/);
  assert.match(report, /results\/run1\.json/);
  assert.match(report, /results\/run2\.json/);
});

test('renderCompareReport shows primary model change', () => {
  const baseline = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 90, 500),
    makeResult('model-b', 'case-1', 'completed', 60, 500),
  ]);
  const candidate = makeRun(['model-a', 'model-b'], [
    makeResult('model-a', 'case-1', 'completed', 60, 500),
    makeResult('model-b', 'case-1', 'completed', 90, 500),
  ]);
  const compare = compareRuns(baseline, candidate);
  const report = renderCompareReport(compare);
  assert.match(report, /CHANGED/);
  assert.match(report, /model-a/);
  assert.match(report, /model-b/);
});

test('renderCompareReport shows summary counts', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 80, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 60, 500),
  ]);
  const compare = compareRuns(baseline, candidate);
  const report = renderCompareReport(compare);
  assert.match(report, /1 regression/);
});

test('renderCompareReport includes model changes table', () => {
  const baseline = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 60, 800)]);
  const candidate = makeRun(['model-a'], [makeResult('model-a', 'case-1', 'completed', 80, 500)]);
  const compare = compareRuns(baseline, candidate);
  const report = renderCompareReport(compare);
  assert.match(report, /Model Changes/);
  assert.match(report, /model-a/);
  assert.match(report, /\+20/);
});

test('renderCompareReport shows case status changes section when failures exist', () => {
  const baseline = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'completed', 100, 500),
  ]);
  const candidate = makeRun(['model-a'], [
    makeResult('model-a', 'case-1', 'provider_error', 0, 500),
  ]);
  const compare = compareRuns(baseline, candidate);
  const report = renderCompareReport(compare);
  assert.match(report, /Case Status Changes/);
  assert.match(report, /case-1/);
  assert.match(report, /NEW FAILURE/);
});
