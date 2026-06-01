import { aggregateResults, recommendModel, scoreOutput } from './scoring.js';

export async function runBenchmark({ models, cases, client, now = () => Date.now() }) {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const model of models) {
    for (const testCase of cases) {
      const start = now();
      try {
        const response = await client({ model, testCase });
        const latencyMs = Math.max(0, now() - start);
        const scored = scoreOutput(response.output, testCase);
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
        });
      } catch (error) {
        const latencyMs = Math.max(0, now() - start);
        const baseMessage = error.message ?? 'unknown model request error';
        results.push({
          model,
          test_case_id: testCase.id,
          test_case_name: testCase.name,
          category: testCase.metadata?.category ?? 'uncategorized',
          status: 'error',
          output: '',
          score: 0,
          passed: false,
          score_reason: 'model request failed',
          latency_ms: latencyMs,
          usage: null,
          error_type: error.type ?? 'unknown_error',
          error_status: error.status ?? null,
          error_body_preview: error.body_preview ?? null,
          error_message: `model ${model} failed case ${testCase.id}: ${baseMessage}`,
        });
      }
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
