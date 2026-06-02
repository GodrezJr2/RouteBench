import test from 'node:test';
import assert from 'node:assert/strict';

import { runBenchmark } from '../src/runner.js';
import { recommendModel } from '../src/scoring.js';

test('repeats collapse to one row per case with mean score and stddev', async () => {
  let call = 0;
  // alternate correct/incorrect so the score varies run-to-run
  const client = async () => {
    call += 1;
    return { output: call % 2 === 1 ? 'jakarta' : 'wrong', usage: { total_tokens: 2 } };
  };
  const cases = [{ id: 'iqa_001', system: 's', prompt: 'p', scoring: 'contains', expected: { contains: ['jakarta'] }, metadata: { category: 'indonesian_qa' } }];

  const result = await runBenchmark({ models: ['m'], cases, client, now: () => 0, repeats: 3 });
  assert.equal(result.repeats, 3);
  assert.equal(result.results.length, 1); // collapsed, not 3 rows
  const row = result.results[0];
  assert.equal(row.runs, 3);
  assert.equal(row.score_samples.length, 3);
  assert.ok(row.score_stddev > 0); // varied → non-zero spread
  assert.ok(row.score >= 0 && row.score <= 100);
});

test('aggregate carries model score_stddev when repeated', async () => {
  let call = 0;
  const client = async () => { call += 1; return { output: call % 2 === 1 ? 'jakarta' : 'no', usage: null }; };
  const cases = [{ id: 'iqa_001', system: 's', prompt: 'p', scoring: 'contains', expected: { contains: ['jakarta'] }, metadata: { category: 'indonesian_qa' } }];
  const result = await runBenchmark({ models: ['m'], cases, client, now: () => 0, repeats: 4 });
  assert.ok(result.aggregate.models.m.score_stddev != null);
  assert.ok(result.aggregate.models.m.score_stddev > 0);
});

test('confidence is low when the top two are within run-to-run noise', () => {
  const aggregate = {
    models: {
      a: { model: 'a', overall_score: 82, avg_latency_ms: 500, error_rate: 0, score_stddev: 12 },
      b: { model: 'b', overall_score: 80, avg_latency_ms: 500, error_rate: 0, score_stddev: 11 },
    },
  };
  const rec = recommendModel(aggregate);
  assert.equal(rec.confidence, 'low');
  assert.match(rec.confidence_reason, /noise|tie/i);
  assert.match(rec.reason, /⚠/);
});

test('confidence is high when the leader is clearly ahead', () => {
  const aggregate = {
    models: {
      a: { model: 'a', overall_score: 95, avg_latency_ms: 500, error_rate: 0, score_stddev: 2 },
      b: { model: 'b', overall_score: 60, avg_latency_ms: 500, error_rate: 0, score_stddev: 2 },
    },
  };
  const rec = recommendModel(aggregate);
  assert.equal(rec.confidence, 'high');
  assert.doesNotMatch(rec.reason, /⚠/);
});

test('without repeats, close scores warn to repeat the run', () => {
  const aggregate = {
    models: {
      a: { model: 'a', overall_score: 81, avg_latency_ms: 500, error_rate: 0 },
      b: { model: 'b', overall_score: 80, avg_latency_ms: 500, error_rate: 0 },
    },
  };
  const rec = recommendModel(aggregate);
  assert.equal(rec.confidence, 'low');
  assert.match(rec.confidence_reason, /ROUTEBENCH_REPEAT/);
});
