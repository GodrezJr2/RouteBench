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
      {
        model: 'ComboOP',
        recommendation_score: 100,
        overall_score: 100,
        avg_latency_ms: 1000,
        error_rate: 0,
        score_reason: 'Strong quality score (100).',
        latency_reason: 'Fast average latency (1000ms).',
        error_rate_reason: 'No failed requests.',
      },
      {
        model: 'bad-model',
        recommendation_score: 0,
        overall_score: 0,
        avg_latency_ms: 500,
        error_rate: 1,
        score_reason: 'Weak quality score (0).',
        latency_reason: 'Fast average latency (500ms).',
        error_rate_reason: 'High error rate (100%).',
      },
    ],
  },
  results: [
    {
      model: 'ComboOP',
      test_case_id: 'case_1',
      test_case_name: 'Case 1',
      category: 'exact',
      status: 'completed',
      score: 100,
      passed: true,
      latency_ms: 1000,
      output: 'OK',
      score_reason: 'exact match',
    },
    {
      model: 'bad-model',
      test_case_id: 'case_1',
      test_case_name: 'Case 1',
      category: 'exact',
      status: 'error',
      score: 0,
      passed: false,
      latency_ms: 500,
      output: '',
      error_message: 'model bad-model failed case case_1: provider returned 422',
      error_type: 'provider_http_error',
      failure_diagnosis: {
        type: 'provider_error',
        summary: 'Provider request failed before scoring: provider returned 422',
        evidence: { error_type: 'provider_http_error', error_status: null },
      },
    },
  ],
};

test('renders markdown report with recommendation ranked models and failures', () => {
  const markdown = renderMarkdownReport(result);

  assert.match(markdown, /# RouteBench Report/);
  assert.match(markdown, /Primary model: `ComboOP`/);
  assert.match(markdown, /bad-model/);
  assert.match(markdown, /Failed Cases/);
  assert.match(markdown, /provider_http_error/);
  assert.match(markdown, /Failure Diagnosis/);
  assert.match(markdown, /Provider request failed before scoring/);
  assert.match(markdown, /Category Breakdown/);
});
