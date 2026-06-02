import {
  aggregateResults,
  recommendModel,
  scoreOutput,
  aggregateByCategory,
  recommendByCategory,
} from './scoring.js';

function calcCost(usage, costs) {
  if (!usage || !costs) return null;
  const input = (usage.prompt_tokens ?? 0) / 1000;
  const output = (usage.completion_tokens ?? 0) / 1000;
  const cost = input * (costs.input_per_1k ?? 0) + output * (costs.output_per_1k ?? 0);
  return Number(cost.toFixed(6));
}

// Run a single model/case pair and return one result row.
async function runCase({ model, testCase, client, now, modelCosts, judge, judgeCategories }) {
  const category = testCase.metadata?.category ?? 'uncategorized';
  const base = { model, test_case_id: testCase.id, test_case_name: testCase.name, category };
  const start = now();

  let response;
  try {
    response = await client({ model, testCase });
  } catch (error) {
    return {
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
    };
  }

  const latencyMs = Math.max(0, now() - start);

  if (!response.output || response.output.trim() === '') {
    return {
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
    };
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
    return {
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
    };
  }

  return {
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
}) {
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
      results[task.order] = await runCase({ model: task.model, testCase: task.testCase, client, now, modelCosts, judge, judgeCategories });
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length || 1));
  const workers = [];
  for (let i = 0; i < limit; i += 1) workers.push(worker());
  await Promise.all(workers);

  const aggregate = aggregateResults(results);
  const recommendation = recommendModel(aggregate);
  const categoryAggregate = aggregateByCategory(results);
  const categoryRouting = recommendByCategory(categoryAggregate);

  return {
    schema_version: 'routebench.phase0.v1',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    models,
    test_cases: cases.map(({ id, name, scoring, metadata }) => ({ id, name, scoring, metadata: metadata ?? {} })),
    results,
    aggregate,
    recommendation,
    category_aggregate: categoryAggregate,
    category_routing: categoryRouting,
  };
}
