import { aggregateResults, recommendModel, scoreOutput } from './scoring.js';

function calcCost(usage, costs) {
  if (!usage || !costs) return null;
  const input = (usage.prompt_tokens ?? 0) / 1000;
  const output = (usage.completion_tokens ?? 0) / 1000;
  const cost = input * (costs.input_per_1k ?? 0) + output * (costs.output_per_1k ?? 0);
  return Number(cost.toFixed(6));
}

export async function runBenchmark({ models, cases, client, now = () => Date.now(), modelCosts = {}, onProgress }) {
  const startedAt = new Date().toISOString();
  const results = [];
  const totalCases = models.length * cases.length;
  let doneCases = 0;
  function tick() { doneCases += 1; if (onProgress) onProgress(doneCases, totalCases); }

  for (const model of models) {
    for (const testCase of cases) {
      const start = now();
      let response;
      try {
        response = await client({ model, testCase });
      } catch (error) {
        const latencyMs = Math.max(0, now() - start);
        const baseMessage = error.message ?? 'unknown model request error';
        results.push({
          model,
          test_case_id: testCase.id,
          test_case_name: testCase.name,
          category: testCase.metadata?.category ?? 'uncategorized',
          status: 'provider_error',
          output: '',
          score: 0,
          passed: false,
          score_reason: 'model request failed',
          latency_ms: latencyMs,
          usage: null,
          estimated_cost_usd: null,
          error_type: error.type ?? 'unknown_error',
          error_status: error.status ?? null,
          error_body_preview: error.body_preview ?? null,
          error_message: `model ${model} failed case ${testCase.id}: ${baseMessage}`,
        });
        tick();
        continue;
      }

      const latencyMs = Math.max(0, now() - start);

      if (!response.output || response.output.trim() === '') {
        results.push({
          model,
          test_case_id: testCase.id,
          test_case_name: testCase.name,
          category: testCase.metadata?.category ?? 'uncategorized',
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
        });
        tick();
        continue;
      }

      let scored;
      try {
        scored = scoreOutput(response.output, testCase);
      } catch (scorerError) {
        results.push({
          model,
          test_case_id: testCase.id,
          test_case_name: testCase.name,
          category: testCase.metadata?.category ?? 'uncategorized',
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
        });
        tick();
        continue;
      }

      results.push({
        model,
        test_case_id: testCase.id,
        test_case_name: testCase.name,
        category: testCase.metadata?.category ?? 'uncategorized',
        status: 'completed',
        output: response.output,
        score: scored.score,
        passed: scored.passed,
        score_reason: scored.reason,
        latency_ms: latencyMs,
        usage: response.usage ?? null,
        estimated_cost_usd: calcCost(response.usage, modelCosts?.[model]),
      });
      tick();
    }
  }

  const aggregate = aggregateResults(results);
  const recommendation = recommendModel(aggregate);
  return {
    schema_version: 'routebench.phase0.v1',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    models,
    test_cases: cases.map(({ id, name, scoring, metadata }) => ({ id, name, scoring, metadata: metadata ?? {} })),
    results,
    aggregate,
    recommendation,
  };
}
