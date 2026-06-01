import test from 'node:test';
import assert from 'node:assert/strict';

import { runBenchmark } from '../src/runner.js';

const cases = [
  {
    id: 'exact_math',
    name: 'Exact arithmetic',
    system: 'Return the answer only.',
    prompt: '17 * 23',
    scoring: 'exact',
    expected: { text: '391' },
  },
  {
    id: 'json_product',
    name: 'JSON extraction',
    system: 'Return JSON only.',
    prompt: 'Extract product and price from: iPhone 15 Pro Max Rp19.999.000',
    scoring: 'json_schema',
    expected: { required: { product_name: 'iPhone 15 Pro Max', price: 19999000 } },
  },
];

test('runs benchmark across all models and cases', async () => {
  const calls = [];
  const client = async ({ model, testCase }) => {
    calls.push(`${model}:${testCase.id}`);
    if (model === 'good-model' && testCase.id === 'exact_math') return { output: '391', usage: { total_tokens: 4 } };
    if (model === 'good-model' && testCase.id === 'json_product') {
      return { output: '{"product_name":"iPhone 15 Pro Max","price":19999000}', usage: { total_tokens: 20 } };
    }
    return { output: 'wrong', usage: { total_tokens: 3 } };
  };

  const result = await runBenchmark({ models: ['good-model', 'bad-model'], cases, client, now: () => 1000 });

  assert.equal(result.results.length, 4);
  assert.deepEqual(calls.sort(), [
    'bad-model:exact_math',
    'bad-model:json_product',
    'good-model:exact_math',
    'good-model:json_product',
  ]);
  assert.equal(result.aggregate.models['good-model'].overall_score, 100);
  assert.equal(result.recommendation.primary_model, 'good-model');
});

test('records model errors as result rows', async () => {
  const client = async ({ model }) => {
    if (model === 'broken-model') throw new Error('provider unavailable');
    return { output: '391', usage: { total_tokens: 4 } };
  };

  const result = await runBenchmark({ models: ['ok-model', 'broken-model'], cases: [cases[0]], client, now: () => 1000 });
  const errorRow = result.results.find((row) => row.model === 'broken-model');

  assert.equal(errorRow.status, 'error');
  assert.equal(errorRow.score, 0);
  assert.match(errorRow.error_message, /broken-model/);
  assert.match(errorRow.error_message, /exact_math/);
  assert.match(errorRow.error_message, /provider unavailable/);
  assert.equal(result.aggregate.models['broken-model'].error_rate, 1);
});

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
