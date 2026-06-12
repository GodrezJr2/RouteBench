import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateResults } from '../src/scoring.js';

function row(model, usage) {
  return { model, score: 100, latency_ms: 10, status: 'completed', usage };
}

test('aggregateResults sums prompt/completion/cached tokens and cache-hit rate', () => {
  const results = [
    row('m', { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 40 } }),
    row('m', { prompt_tokens: 200, completion_tokens: 30, cached_tokens: 60 }), // flat form
  ];
  const { models } = aggregateResults(results);
  const m = models.m;
  assert.equal(m.total_prompt_tokens, 300);
  assert.equal(m.total_completion_tokens, 80);
  assert.equal(m.total_cached_tokens, 100);
  assert.equal(m.cache_hit_rate, 0.3333);
});

test('aggregateResults reports null token fields when usage is absent', () => {
  const results = [{ model: 'm', score: 100, latency_ms: 10, status: 'completed', usage: null }];
  const m = aggregateResults(results).models.m;
  assert.equal(m.total_prompt_tokens, null);
  assert.equal(m.total_cached_tokens, null);
  assert.equal(m.cache_hit_rate, null);
});

test('aggregateResults handles usage without any cached field as zero cached', () => {
  const results = [row('m', { prompt_tokens: 100, completion_tokens: 50 })];
  const m = aggregateResults(results).models.m;
  assert.equal(m.total_cached_tokens, 0);
  assert.equal(m.cache_hit_rate, 0);
});
