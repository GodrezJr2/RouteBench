import test from 'node:test';
import assert from 'node:assert/strict';

import { runBenchmark } from '../src/runner.js';
import { renderRouteExport } from '../src/routeExport.js';

const singleCase = {
  id: 'exact_math',
  name: 'Exact arithmetic',
  system: 'Return only the answer.',
  prompt: '17 * 23',
  scoring: 'exact',
  expected: { text: '391' },
  metadata: { category: 'exact' },
};

test('benchmark result JSON does not contain API key', async () => {
  const fakeApiKey = 'sk-super-secret-do-not-leak';
  const client = async () => ({ output: '391', usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } });

  const result = await runBenchmark({ models: ['model-a'], cases: [singleCase], client });
  const json = JSON.stringify(result);

  assert.ok(!json.includes(fakeApiKey), 'result JSON must not contain API key');
});

test('routing export does not contain api_key field or bearer token', async () => {
  const result = await runBenchmark({
    models: ['model-a', 'model-b'],
    cases: [singleCase],
    client: async () => ({ output: '391', usage: {} }),
  });

  const exported = renderRouteExport(result, { baseUrl: 'https://router.example.com/v1' });
  const json = JSON.stringify(exported);

  assert.ok(!json.includes('api_key'));
  assert.ok(!json.includes('Bearer'));
  assert.ok(!json.includes('sk-'));
});

test('result aggregate does not expose internal config fields', async () => {
  const result = await runBenchmark({
    models: ['model-a'],
    cases: [singleCase],
    client: async () => ({ output: '391', usage: {} }),
  });

  assert.ok(!('apiKey' in result));
  assert.ok(!('baseUrl' in result));
  assert.ok(!('timeoutMs' in result));
});
