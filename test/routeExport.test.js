import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRouteExport, validateRouteExport } from '../src/routeExport.js';

const sampleResult = {
  finished_at: '2026-06-01T00:00:00.000Z',
  recommendation: {
    primary_model: 'model-a',
    fallback_models: ['model-b'],
    ranked_models: [
      {
        model: 'model-a',
        recommendation_score: 80,
        overall_score: 82,
        avg_latency_ms: 1000,
        error_rate: 0,
        score_reason: 'Usable quality score (82).',
        latency_reason: 'Fast average latency (1000ms).',
        error_rate_reason: 'No failed requests.',
      },
      {
        model: 'model-b',
        recommendation_score: 70,
        overall_score: 65,
        avg_latency_ms: 500,
        error_rate: 0.1,
        score_reason: 'Weak quality score (65).',
        latency_reason: 'Fast average latency (500ms).',
        error_rate_reason: 'Low error rate (10%).',
      },
    ],
  },
};

test('renders routing export with schema_version and routing_rules', () => {
  const exported = renderRouteExport(sampleResult, { baseUrl: 'https://router.example.com/v1' });

  assert.equal(exported.schema_version, 'routebench.routing.v1');
  assert.equal(exported.endpoint, 'https://router.example.com/v1');
  assert.equal(exported.primary_model, 'model-a');
  assert.deepEqual(exported.fallback_models, ['model-b']);
  assert.equal(exported.routing_rules.length, 2);
  assert.equal(exported.routing_rules[0].priority, 1);
  assert.equal(exported.routing_rules[0].model, 'model-a');
  assert.equal(exported.routing_rules[1].priority, 2);
  assert.equal(exported.routing_rules[1].model, 'model-b');
});

test('routing export excludes api_key', () => {
  const exported = renderRouteExport(sampleResult, { baseUrl: 'https://router.example.com/v1' });
  const json = JSON.stringify(exported);

  assert.ok(!json.includes('api_key'));
  assert.ok(!json.includes('sk-'));
});

test('routing export includes reason per rule', () => {
  const exported = renderRouteExport(sampleResult);
  const rule = exported.routing_rules[0];

  assert.ok(rule.reason.includes('Usable quality score'));
  assert.ok(rule.reason.includes('Fast average latency'));
  assert.ok(rule.reason.includes('No failed requests'));
});

test('validateRouteExport passes valid export', () => {
  const exported = renderRouteExport(sampleResult, { baseUrl: 'https://router.example.com/v1' });
  const { valid, errors } = validateRouteExport(exported);
  assert.equal(valid, true);
  assert.equal(errors.length, 0);
});

test('validateRouteExport catches missing required fields', () => {
  const { valid, errors } = validateRouteExport({ schema_version: 'wrong', routing_rules: 'not-array' });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('schema_version')));
  assert.ok(errors.some((e) => e.includes('routing_rules')));
});
