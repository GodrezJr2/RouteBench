import {
  aggregateResults,
  recommendModel,
  scoreOutput,
  aggregateByCategory,
  recommendByCategory,
  aggregateByDifficulty,
  aggregateByLanguage,
} from './scoring.js';
import { diagnoseCaseFailure } from './caseDiagnosis.js';
import { generateDiagnosis } from './diagnosis.js';

function calcCost(usage, costs) {
  if (!usage || !costs) return null;
  const input = (usage.prompt_tokens ?? 0) / 1000;
  const output = (usage.completion_tokens ?? 0) / 1000;
  const cost = input * (costs.input_per_1k ?? 0) + output * (costs.output_per_1k ?? 0);
  return Number(cost.toFixed(6));
}

function withFailureDiagnosis(row, testCase) {
  return {
    ...row,
    failure_diagnosis: diagnoseCaseFailure({ testCase, output: row.output, row }),
  };
}

// Run a single model/case pair and return one result row.
async function runCase({ model, testCase, client, now, modelCosts, judge, judgeCategories }) {
  const category = testCase.metadata?.category ?? 'uncategorized';
  const difficulty = testCase.metadata?.difficulty ?? 'unspecified';
  const language = testCase.metadata?.language ?? null;
  const base = { model, test_case_id: testCase.id, test_case_name: testCase.name, category, difficulty, language };
  const start = now();

  let response;
  try {
    response = await client({ model, testCase });
  } catch (error) {
    return withFailureDiagnosis({
      ...base,
      status: 'provider_error',
      output: '',
      score: 0,
      passed: false,
      score_reason: 'model request failed',
      latency_ms: Math.max(0, now() - start),
      usage: null,
      estimated_cost_usd: null,
      error_type: error.type ?? 'unknown_error',
      error_status: error.status ?? null,
      error_body_preview: error.body_preview ?? null,
      error_message: `model ${model} failed case ${testCase.id}: ${error.message ?? 'unknown model request error'}`,
    }, testCase);
  }

  const latencyMs = Math.max(0, now() - start);

  if (!response.output || response.output.trim() === '') {
    return withFailureDiagnosis({
      ...base,
      status: 'model_failure',
      output: '',
      score: 0,
      passed: false,
      score_reason: 'model returned empty output',
      latency_ms: latencyMs,
      usage: response.usage ?? null,
      estimated_cost_usd: calcCost(response.usage, modelCosts?.[model]),
      error_type: 'empty_output',
      error_status: null,
      error_body_preview: null,
      error_message: `model ${model} returned empty output for case ${testCase.id}`,
    }, testCase);
  }

  const useJudge = judge && judgeCategories?.includes(category);
  let scored;
  let scoredBy = 'deterministic';
  let judgeReason = null;
  let judgeError = null;
  try {
    if (useJudge) {
      try {
        scored = await judge(testCase, response.output);
        scoredBy = 'judge';
        judgeReason = scored.judge_reason ?? null;
      } catch (judgeFailure) {
        // Judge failed — fall back to the deterministic scorer rather than
        // dropping the case, and record why the judge didn't run.
        scored = scoreOutput(response.output, testCase);
        scoredBy = 'deterministic_fallback';
        judgeError = judgeFailure.message;
      }
    } else {
      scored = scoreOutput(response.output, testCase);
    }
  } catch (scorerError) {
    return withFailureDiagnosis({
      ...base,
      status: 'scorer_failure',
      output: response.output,
      score: 0,
      passed: false,
      score_reason: `scorer threw: ${scorerError.message}`,
      latency_ms: latencyMs,
      usage: response.usage ?? null,
      estimated_cost_usd: calcCost(response.usage, modelCosts?.[model]),
      error_type: 'scorer_exception',
      error_status: null,
      error_body_preview: null,
      error_message: `scorer failed for model ${model} case ${testCase.id}: ${scorerError.message}`,
    }, testCase);
  }

  return withFailureDiagnosis({
    ...base,
    status: 'completed',
    output: response.output,
    score: scored.score,
    passed: scored.passed,
    score_reason: scored.reason,
    scored_by: scoredBy,
    judge_reason: judgeReason,
    judge_error: judgeError,
    latency_ms: latencyMs,
    usage: response.usage ?? null,
    estimated_cost_usd: calcCost(response.usage, modelCosts?.[model]),
  }, testCase);
}

function mean(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

// Collapse repeated runs of one (model, case) into a single row carrying the
// mean score, run-to-run spread, and per-case error rate.
function collapseRepeats(rows, repeats) {
  const successes = rows.filter((r) => r.status === 'completed');
  const scores = successes.map((r) => Number(r.score ?? 0));
  const latencies = successes.map((r) => Number(r.latency_ms ?? 0));
  const costs = rows.map((r) => r.estimated_cost_usd).filter((c) => c != null);
  const base = rows[0];

  if (successes.length === 0) {
    // Every repeat failed — keep the first failure row but record the spread.
    return { ...base, runs: repeats, success_count: 0, score_stddev: 0, score_samples: [] };
  }

  const meanScore = Math.round(mean(scores));
  const spread = stddev(scores);
  const failureDiagnosis = meanScore >= 70 ? null : {
    type: 'repeat_low_mean',
    summary: `Mean score ${meanScore} across ${successes.length}/${repeats} runs is below the passing threshold.`,
    evidence: { score_samples: scores, success_count: successes.length, runs: repeats },
  };
  return {
    ...successes[0],
    status: 'completed',
    score: meanScore,
    passed: meanScore >= 70,
    score_reason: `mean of ${successes.length}/${repeats} runs (±${spread.toFixed(1)})`,
    latency_ms: Math.round(mean(latencies)),
    runs: repeats,
    success_count: successes.length,
    score_stddev: Number(spread.toFixed(2)),
    score_samples: scores,
    failure_diagnosis: failureDiagnosis,
    estimated_cost_usd: costs.length ? Number(costs.reduce((s, c) => s + c, 0).toFixed(6)) : null,
  };
}

export async function runBenchmark({
  models,
  cases,
  client,
  now = () => Date.now(),
  modelCosts = {},
  onProgress,
  concurrency = 4,
  judge = null,
  judgeCategories = [],
  repeats = 1,
  prefer = 'balanced',
}) {
  const runRepeats = Math.max(1, Math.floor(repeats) || 1);
  const startedAt = new Date().toISOString();

  // Build the full task list; `order` keeps the output stable (model-major,
  // case order) regardless of completion order under parallel execution.
  const tasks = [];
  models.forEach((model) => {
    cases.forEach((testCase) => {
      tasks.push({ model, testCase, order: tasks.length });
    });
  });

  const results = new Array(tasks.length);
  const total = tasks.length;
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      const args = { model: task.model, testCase: task.testCase, client, now, modelCosts, judge, judgeCategories };
      if (runRepeats === 1) {
        results[task.order] = await runCase(args);
      } else {
        const rows = [];
        for (let i = 0; i < runRepeats; i += 1) rows.push(await runCase(args));
        results[task.order] = collapseRepeats(rows, runRepeats);
      }
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length || 1));
  const workers = [];
  for (let i = 0; i < limit; i += 1) workers.push(worker());
  await Promise.all(workers);

  const aggregate = aggregateResults(results);
  const recommendation = recommendModel(aggregate, { prefer });
  const categoryAggregate = aggregateByCategory(results);
  const categoryRouting = recommendByCategory(categoryAggregate);
  const difficultyAggregate = aggregateByDifficulty(results);
  const languageAggregate = aggregateByLanguage(results);
  const diagnosis = generateDiagnosis({ aggregate, categoryAggregate, categoryRouting });

  return {
    schema_version: 'routebench.phase0.v1',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    models,
    repeats: runRepeats,
    test_cases: cases.map(({ id, name, scoring, metadata }) => ({ id, name, scoring, metadata: metadata ?? {} })),
    results,
    aggregate,
    recommendation,
    category_aggregate: categoryAggregate,
    category_routing: categoryRouting,
    difficulty_aggregate: difficultyAggregate,
    language_aggregate: languageAggregate,
    diagnosis,
  };
}
