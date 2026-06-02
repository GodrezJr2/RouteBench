import test from 'node:test';
import assert from 'node:assert/strict';

import { generateDiagnosis } from '../src/diagnosis.js';

const fixture = {
  aggregate: {
    models: {
      fast: { model: 'fast', overall_score: 79, avg_latency_ms: 1116, p95_latency_ms: 2372, error_rate: 0.14, total_estimated_cost_usd: 0.0012 },
      slow: { model: 'slow', overall_score: 88, avg_latency_ms: 5000, p95_latency_ms: 9000, error_rate: 0, total_estimated_cost_usd: 0.05 },
    },
  },
  categoryAggregate: {
    json_compliance: { models: { fast: { avg_score: 100 }, slow: { avg_score: 90 } } },
    summarization_quality: { models: { fast: { avg_score: 55 }, slow: { avg_score: 92 } } },
  },
  categoryRouting: [
    { category: 'json_compliance', primary_model: 'fast' },
    { category: 'summarization_quality', primary_model: 'slow' },
  ],
};

test('diagnosis names strengths, weaknesses, and never hides bad scores', () => {
  const diag = generateDiagnosis(fixture);
  const fast = diag.find((d) => d.model === 'fast');
  assert.match(fast.text, /Usable overall \(79\)/);
  assert.match(fast.text, /Strong on json compliance \(100\)/);
  assert.match(fast.text, /Weak on summarization quality \(55\)/); // bad score surfaced
  assert.match(fast.text, /14% of requests failed/); // unreliability surfaced
  assert.match(fast.text, /primary for json compliance/);
  assert.deepEqual(fast.weaknesses, ['summarization_quality']);
});

test('diagnosis reports clean reliability and primary roles', () => {
  const diag = generateDiagnosis(fixture);
  const slow = diag.find((d) => d.model === 'slow');
  assert.match(slow.text, /Good overall \(88\)/);
  assert.match(slow.text, /No failed requests/);
  assert.match(slow.text, /Moderate latency — average 5000ms \(p95 9000ms\)/);
  assert.match(slow.text, /primary for summarization quality/);
});

test('diagnosis handles a model that wins nothing', () => {
  const diag = generateDiagnosis({
    aggregate: { models: { meh: { model: 'meh', overall_score: 40, avg_latency_ms: 3000, error_rate: 0 } } },
    categoryAggregate: { json_compliance: { models: { meh: { avg_score: 40 } } } },
    categoryRouting: [{ category: 'json_compliance', primary_model: 'other' }],
  });
  assert.match(diag[0].text, /Poor overall \(40\)/);
  assert.match(diag[0].text, /Not the top pick for any task category/);
});
