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
