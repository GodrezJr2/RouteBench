import test from 'node:test';
import assert from 'node:assert/strict';

import { createPromptfooConfig } from '../src/promptfoo.js';

const benchmark = {
  cases: [
    { id: 'exact_math', name: 'Exact math', system: 'Answer only.', prompt: '17 * 23', scoring: 'exact', expected: { text: '391' } },
    { id: 'json_product', name: 'JSON product', system: 'Return JSON only.', prompt: 'Extract product.', scoring: 'json_schema', expected: { required: { product_name: 'iPhone' } } },
  ],
};

test('creates promptfoo config for OpenAI-compatible model comparison', () => {
  const config = createPromptfooConfig({
    baseUrl: 'https://router.example.com/v1',
    apiKeyEnv: 'ROUTEBENCH_API_KEY',
    models: ['model-a', 'model-b'],
    benchmark,
  });

  assert.match(config, /apiBaseUrl: https:\/\/router\.example\.com\/v1/);
  assert.match(config, /apiKeyEnvar: ROUTEBENCH_API_KEY/);
  assert.match(config, /id: openai:chat:model-a/);
  assert.match(config, /id: openai:chat:model-b/);
  assert.match(config, /Exact math/);
  assert.match(config, /JSON product/);
});
