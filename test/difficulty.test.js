import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateByDifficulty, sortDifficultyTiers } from '../src/scoring.js';
import { runBenchmark } from '../src/runner.js';
import { renderMarkdownReport } from '../src/report.js';

function rows() {
  return [
    { model: 'a', difficulty: 'easy', score: 100, status: 'completed' },
    { model: 'a', difficulty: 'easy', score: 100, status: 'completed' },
    { model: 'a', difficulty: 'hard', score: 20, status: 'completed' },
    { model: 'a', difficulty: 'hard', score: 0, status: 'provider_error' },
  ];
}

test('aggregateByDifficulty groups by tier then model', () => {
  const agg = aggregateByDifficulty(rows());
  assert.equal(agg.easy.models.a.avg_score, 100);
  assert.equal(agg.easy.models.a.error_rate, 0);
  assert.equal(agg.hard.models.a.avg_score, 10); // (20 + 0) / 2
  assert.equal(agg.hard.models.a.error_rate, 0.5);
  assert.equal(agg.hard.models.a.test_count, 2);
});

test('sortDifficultyTiers orders easy < medium < hard, unknown last', () => {
  assert.deepEqual(sortDifficultyTiers(['hard', 'easy', 'medium']), ['easy', 'medium', 'hard']);
  assert.deepEqual(sortDifficultyTiers(['weird', 'easy']), ['easy', 'weird']);
});

test('runBenchmark exposes difficulty_aggregate and rows carry difficulty', async () => {
  const cases = [
    { id: 'e1', name: 'e', scoring: 'exact', expected: { text: 'x' }, metadata: { category: 'c', difficulty: 'easy' } },
    { id: 'h1', name: 'h', scoring: 'exact', expected: { text: 'y' }, metadata: { category: 'c', difficulty: 'hard' } },
  ];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  const result = await runBenchmark({ models: ['m'], cases, client });
  assert.ok(result.difficulty_aggregate.easy);
  assert.ok(result.difficulty_aggregate.hard);
  assert.equal(result.results[0].difficulty, 'easy');
  assert.equal(result.results[1].difficulty, 'hard');
});

test('case without difficulty metadata falls back to unspecified', async () => {
  const cases = [{ id: 'c1', name: 'a', scoring: 'exact', expected: { text: 'x' }, metadata: { category: 'c' } }];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  const result = await runBenchmark({ models: ['m'], cases, client });
  assert.equal(result.results[0].difficulty, 'unspecified');
  assert.ok(result.difficulty_aggregate.unspecified);
});

test('report renders Difficulty Breakdown section', async () => {
  const cases = [
    { id: 'e1', name: 'e', scoring: 'exact', expected: { text: 'x' }, metadata: { category: 'c', difficulty: 'easy' } },
    { id: 'h1', name: 'h', scoring: 'exact', expected: { text: 'y' }, metadata: { category: 'c', difficulty: 'hard' } },
  ];
  const client = async ({ testCase }) => ({ output: testCase.expected.text, usage: null });
  const result = await runBenchmark({ models: ['m'], cases, client });
  const md = renderMarkdownReport(result);
  assert.ok(md.includes('## Difficulty Breakdown'));
  assert.ok(md.includes('| Difficulty | Model |'));
});
