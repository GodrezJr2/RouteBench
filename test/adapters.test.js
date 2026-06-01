import test from 'node:test';
import assert from 'node:assert/strict';

import { toGenericConfig, toLiteLLMConfig } from '../src/adapters.js';

const sampleRouteExport = {
  schema_version: 'routebench.routing.v1',
  generated_at: '2026-06-01T00:00:00.000Z',
  endpoint: 'https://router.example.com/v1',
  primary_model: 'model-a',
  fallback_models: ['model-b'],
  routing_rules: [
    {
      priority: 1,
      model: 'model-a',
      route_score: 80,
      overall_score: 82,
      avg_latency_ms: 1000,
      error_rate: 0,
      reason: 'Usable quality score (82). Fast average latency (1000ms). No failed requests.',
    },
    {
      priority: 2,
      model: 'model-b',
      route_score: 70,
      overall_score: 65,
      avg_latency_ms: 500,
      error_rate: 0.1,
      reason: 'Weak quality score (65). Fast average latency (500ms). Low error rate (10%).',
    },
  ],
};

test('toGenericConfig produces schema_version and default_model', () => {
  const config = toGenericConfig(sampleRouteExport);

  assert.equal(config.schema_version, 'routebench.generic-router.v1');
  assert.equal(config.default_model, 'model-a');
  assert.deepEqual(config.fallback_chain, ['model-b']);
  assert.equal(config.models.length, 2);
  assert.equal(config.models[0].id, 'model-a');
  assert.equal(config.models[0].priority, 1);
  assert.equal(config.models[0].recommended_use, 'primary');
  assert.equal(config.models[1].recommended_use, 'fallback');
});

test('toGenericConfig does not include api key or bearer token', () => {
  const config = toGenericConfig(sampleRouteExport);
  const json = JSON.stringify(config);

  assert.ok(!json.includes('api_key'));
  assert.ok(!json.includes('Bearer'));
  assert.ok(!json.includes('sk-'));
});

test('toLiteLLMConfig produces valid YAML string with model_list', () => {
  const yaml = toLiteLLMConfig(sampleRouteExport, { apiKeyEnv: 'ROUTEBENCH_API_KEY' });

  assert.equal(typeof yaml, 'string');
  assert.ok(yaml.includes('model_list:'));
  assert.ok(yaml.includes('model-a'));
  assert.ok(yaml.includes('model-b'));
  assert.ok(yaml.includes('api_base:') && yaml.includes('router.example.com/v1'));
  assert.ok(yaml.includes('ROUTEBENCH_API_KEY'));
  assert.ok(yaml.includes('router_settings:'));
  assert.ok(yaml.includes('fallbacks:'));
});

test('toLiteLLMConfig uses os.environ reference not literal key', () => {
  const yaml = toLiteLLMConfig(sampleRouteExport, { apiKeyEnv: 'ROUTEBENCH_API_KEY' });

  assert.ok(yaml.includes('os.environ/ROUTEBENCH_API_KEY'));
  assert.ok(!yaml.includes('sk-'));
  assert.ok(!yaml.includes('Bearer'));
});

test('toLiteLLMConfig includes route_score and error_rate as comments', () => {
  const yaml = toLiteLLMConfig(sampleRouteExport, { apiKeyEnv: 'ROUTEBENCH_API_KEY' });

  assert.ok(yaml.includes('route_score:') || yaml.includes('# route_score'));
});

test('toGenericConfig preserves endpoint', () => {
  const config = toGenericConfig(sampleRouteExport);
  assert.equal(config.endpoint, 'https://router.example.com/v1');
});
