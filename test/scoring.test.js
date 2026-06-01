import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreOutput, aggregateResults, recommendModel } from '../src/scoring.js';

test('scores valid JSON schema output with correct fields', () => {
  const testCase = {
    id: 'json_product',
    scoring: 'json_schema',
    expected: {
      required: {
        product_name: 'iPhone 15 Pro Max',
        price: 19999000,
      },
    },
  };

  const result = scoreOutput('{"product_name":"iPhone 15 Pro Max","price":19999000}', testCase);

  assert.equal(result.score, 100);
  assert.equal(result.passed, true);
  assert.equal(result.reason, 'valid JSON and required fields matched');
});

test('penalizes invalid JSON output', () => {
  const testCase = {
    id: 'json_product',
    scoring: 'json_schema',
    expected: { required: { product_name: 'iPhone 15 Pro Max' } },
  };

  const result = scoreOutput('```json\n{"product_name":"iPhone"}\n```', testCase);

  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'output is not valid JSON');
});

test('aggregates model results with latency and error rate', () => {
  const results = [
    { model: 'fast-good', score: 100, latency_ms: 100, status: 'completed' },
    { model: 'fast-good', score: 50, latency_ms: 300, status: 'completed' },
    { model: 'slow-bad', score: 20, latency_ms: 1000, status: 'completed' },
    { model: 'slow-bad', score: 0, latency_ms: 2000, status: 'error' },
  ];

  const aggregate = aggregateResults(results);

  assert.equal(aggregate.models['fast-good'].overall_score, 75);
  assert.equal(aggregate.models['fast-good'].avg_latency_ms, 200);
  assert.equal(aggregate.models['fast-good'].error_rate, 0);
  assert.equal(aggregate.models['slow-bad'].overall_score, 10);
  assert.equal(aggregate.models['slow-bad'].error_rate, 0.5);
});

test('recommends model using quality, reliability, and latency', () => {
  const aggregate = {
    models: {
      'accurate-but-broken': {
        model: 'accurate-but-broken',
        overall_score: 95,
        avg_latency_ms: 500,
        error_rate: 0.5,
      },
      'balanced-model': {
        model: 'balanced-model',
        overall_score: 88,
        avg_latency_ms: 700,
        error_rate: 0,
      },
    },
  };

  const recommendation = recommendModel(aggregate);

  assert.equal(recommendation.primary_model, 'balanced-model');
  assert.deepEqual(recommendation.fallback_models, ['accurate-but-broken']);
});

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
