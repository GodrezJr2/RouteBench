import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfigFromEnv, validateConfig } from '../src/config.js';

test('loads OpenAI-compatible config from environment variables', () => {
  const env = {
    ROUTEBENCH_BASE_URL: 'https://router.example.com/v1',
    ROUTEBENCH_API_KEY: 'sk-test',
    ROUTEBENCH_MODELS: 'model-a, model-b',
    ROUTEBENCH_TIMEOUT_MS: '15000',
  };

  const config = loadConfigFromEnv(env);

  assert.equal(config.baseUrl, 'https://router.example.com/v1');
  assert.equal(config.apiKey, 'sk-test');
  assert.deepEqual(config.models, ['model-a', 'model-b']);
  assert.equal(config.timeoutMs, 15000);
});

test('requires at least two models for live benchmark config', () => {
  const config = {
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    models: ['model-a'],
    timeoutMs: 30000,
  };

  assert.throws(() => validateConfig(config), /at least two models/i);
});
