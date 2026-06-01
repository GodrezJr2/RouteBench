import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfigFromEnv, loadConfigFromFile, mergeConfigs, validateConfig } from '../src/config.js';

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

test('loads config from JSON file', () => {
  const fileConfig = {
    base_url: 'https://file.example.com/v1',
    api_key: 'sk-file',
    models: ['file-a', 'file-b'],
    timeout_ms: 60000,
    model_costs: { 'file-a': { input_per_1k: 0.001, output_per_1k: 0.002 } },
  };

  const config = loadConfigFromFile(fileConfig);

  assert.equal(config.baseUrl, 'https://file.example.com/v1');
  assert.equal(config.apiKey, 'sk-file');
  assert.deepEqual(config.models, ['file-a', 'file-b']);
  assert.equal(config.timeoutMs, 60000);
  assert.deepEqual(config.modelCosts, { 'file-a': { input_per_1k: 0.001, output_per_1k: 0.002 } });
});

test('mergeConfigs: env wins over file', () => {
  const fileConf = { baseUrl: 'https://file.example.com/v1', apiKey: 'sk-file', models: ['a', 'b'], timeoutMs: 30000, modelCosts: {} };
  const envConf = { baseUrl: 'https://env.example.com/v1', apiKey: 'sk-env', models: [], timeoutMs: 0, modelCosts: null };

  const merged = mergeConfigs(fileConf, envConf);

  assert.equal(merged.baseUrl, 'https://env.example.com/v1');
  assert.equal(merged.apiKey, 'sk-env');
  assert.deepEqual(merged.models, ['a', 'b']);
  assert.equal(merged.timeoutMs, 30000);
});

test('mergeConfigs: env partial, file fills gaps', () => {
  const fileConf = { baseUrl: 'https://file.example.com/v1', apiKey: 'sk-file', models: ['a', 'b'], timeoutMs: 30000, modelCosts: {} };
  const envConf = { baseUrl: '', apiKey: '', models: [], timeoutMs: 0, modelCosts: null };

  const merged = mergeConfigs(fileConf, envConf);

  assert.equal(merged.baseUrl, 'https://file.example.com/v1');
  assert.equal(merged.apiKey, 'sk-file');
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
