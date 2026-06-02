import test from 'node:test';
import assert from 'node:assert/strict';

import { createJudge, DEFAULT_JUDGE_CATEGORIES } from '../src/judge.js';
import { runBenchmark } from '../src/runner.js';

const tc = { id: 'iqa_001', system: 'Jawab Bahasa Indonesia.', prompt: 'Apa ibu kota Indonesia?', scoring: 'contains', expected: { contains: ['jakarta'] }, metadata: { category: 'indonesian_qa' } };

test('judge parses JSON score and reason, clamps to 0-100', async () => {
  const client = async () => ({ output: '{"score": 88, "reason": "Correct and concise."}', usage: { total_tokens: 9 } });
  const judge = createJudge({ client, judgeModel: 'judge-1' });
  const r = await judge(tc, 'Jakarta');
  assert.equal(r.score, 88);
  assert.equal(r.passed, true);
  assert.equal(r.judge_reason, 'Correct and concise.');
  assert.match(r.reason, /^judge: /);
});

test('judge extracts JSON even with surrounding text and clamps overflow', async () => {
  const client = async () => ({ output: 'Here is my verdict:\n{"score": 250, "reason": "x"}\nthanks' });
  const judge = createJudge({ client, judgeModel: 'judge-1' });
  const r = await judge(tc, 'answer');
  assert.equal(r.score, 100); // clamped
});

test('judge throws on unparseable output', async () => {
  const client = async () => ({ output: 'no json here' });
  const judge = createJudge({ client, judgeModel: 'judge-1' });
  await assert.rejects(() => judge(tc, 'answer'), /unparseable/);
});

test('runner uses judge for judge categories and deterministic elsewhere', async () => {
  const calls = { bench: 0, judge: 0 };
  const benchClient = async ({ model, testCase }) => {
    // distinguish judge calls by the synthetic system prompt
    if (testCase.system?.startsWith('You are a strict evaluation judge')) {
      calls.judge += 1;
      return { output: '{"score": 91, "reason": "good"}' };
    }
    calls.bench += 1;
    return { output: 'jakarta', usage: { total_tokens: 3 } };
  };
  const judge = createJudge({ client: benchClient, judgeModel: 'judge-1' });

  const cases = [
    { id: 'iqa_001', system: 's', prompt: 'p', scoring: 'contains', expected: { contains: ['jakarta'] }, metadata: { category: 'indonesian_qa' } },
    { id: 'math_001', system: 's', prompt: 'p', scoring: 'contains', expected: { contains: ['jakarta'] }, metadata: { category: 'instruction_following_basic' } },
  ];

  const result = await runBenchmark({ models: ['m'], cases, client: benchClient, now: () => 0, judge, judgeCategories: DEFAULT_JUDGE_CATEGORIES });
  const byId = Object.fromEntries(result.results.map((r) => [r.test_case_id, r]));

  assert.equal(byId.iqa_001.scored_by, 'judge');
  assert.equal(byId.iqa_001.score, 91);
  assert.equal(byId.iqa_001.judge_reason, 'good');
  assert.equal(byId.math_001.scored_by, 'deterministic');
  assert.equal(calls.judge, 1); // only the indonesian_qa case judged
});

test('runner falls back to deterministic when judge fails', async () => {
  const benchClient = async ({ testCase }) => {
    if (testCase.system?.startsWith('You are a strict evaluation judge')) {
      return { output: 'garbage not json' }; // judge will throw
    }
    return { output: 'jakarta' };
  };
  const judge = createJudge({ client: benchClient, judgeModel: 'judge-1' });
  const cases = [{ id: 'iqa_001', system: 's', prompt: 'p', scoring: 'contains', expected: { contains: ['jakarta'] }, metadata: { category: 'indonesian_qa' } }];

  const result = await runBenchmark({ models: ['m'], cases, client: benchClient, now: () => 0, judge, judgeCategories: DEFAULT_JUDGE_CATEGORIES });
  const row = result.results[0];
  assert.equal(row.scored_by, 'deterministic_fallback');
  assert.equal(row.status, 'completed');
  assert.equal(row.score, 100); // deterministic contains matched
  assert.match(row.judge_error, /unparseable/);
});
