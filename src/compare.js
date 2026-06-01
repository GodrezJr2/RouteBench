function groupByCategory(results) {
  const groups = {};
  for (const r of results) {
    const cat = r.category ?? 'uncategorized';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(Number(r.score ?? 0));
  }
  return Object.fromEntries(
    Object.entries(groups).map(([cat, scores]) => [
      cat,
      Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
    ]),
  );
}

function computeCategoryChanges(baselineResults, candidateResults, model) {
  const baseCats = groupByCategory(baselineResults.filter((r) => r.model === model));
  const candCats = groupByCategory(candidateResults.filter((r) => r.model === model));
  const allCats = [...new Set([...Object.keys(baseCats), ...Object.keys(candCats)])];
  return allCats.map((category) => {
    const baseline_score = baseCats[category] ?? null;
    const candidate_score = candCats[category] ?? null;
    const delta =
      baseline_score != null && candidate_score != null ? candidate_score - baseline_score : null;
    return { category, baseline_score, candidate_score, delta };
  });
}

function computeCaseChanges(baselineResults, candidateResults, model) {
  const baseMap = new Map(
    baselineResults.filter((r) => r.model === model).map((r) => [r.test_case_id, r]),
  );
  const candMap = new Map(
    candidateResults.filter((r) => r.model === model).map((r) => [r.test_case_id, r]),
  );

  const new_failures = [];
  const recovered = [];
  const status_changes = [];

  for (const [caseId, baseRow] of baseMap) {
    const candRow = candMap.get(caseId);
    if (!candRow) continue;
    const wasCompleted = baseRow.status === 'completed';
    const isCompleted = candRow.status === 'completed';
    if (wasCompleted && !isCompleted) {
      new_failures.push(caseId);
    } else if (!wasCompleted && isCompleted) {
      recovered.push(caseId);
    } else if (baseRow.status !== candRow.status) {
      status_changes.push({
        case_id: caseId,
        baseline_status: baseRow.status,
        candidate_status: candRow.status,
      });
    }
  }

  return { new_failures, recovered, status_changes };
}

export function compareRuns(baseline, candidate, { now = () => new Date().toISOString() } = {}) {
  const allModels = [...new Set([...baseline.models, ...candidate.models])];

  const model_comparisons = allModels.map((model) => {
    const inBaseline = baseline.models.includes(model);
    const inCandidate = candidate.models.includes(model);
    const baseAgg = baseline.aggregate.models[model] ?? null;
    const candAgg = candidate.aggregate.models[model] ?? null;

    const both = inBaseline && inCandidate;
    const score_delta = both ? candAgg.overall_score - baseAgg.overall_score : null;
    const latency_delta_ms = both ? candAgg.avg_latency_ms - baseAgg.avg_latency_ms : null;
    const error_rate_delta = both
      ? Number((candAgg.error_rate - baseAgg.error_rate).toFixed(4))
      : null;

    let cost_delta_usd = null;
    if (
      both &&
      baseAgg.total_estimated_cost_usd != null &&
      candAgg.total_estimated_cost_usd != null
    ) {
      cost_delta_usd = Number(
        (candAgg.total_estimated_cost_usd - baseAgg.total_estimated_cost_usd).toFixed(6),
      );
    }

    const baselineMetrics = baseAgg
      ? {
          overall_score: baseAgg.overall_score,
          avg_latency_ms: baseAgg.avg_latency_ms,
          error_rate: baseAgg.error_rate,
          total_estimated_cost_usd: baseAgg.total_estimated_cost_usd,
        }
      : null;
    const candidateMetrics = candAgg
      ? {
          overall_score: candAgg.overall_score,
          avg_latency_ms: candAgg.avg_latency_ms,
          error_rate: candAgg.error_rate,
          total_estimated_cost_usd: candAgg.total_estimated_cost_usd,
        }
      : null;

    const category_changes = computeCategoryChanges(baseline.results, candidate.results, model);
    const { new_failures, recovered, status_changes } = computeCaseChanges(
      baseline.results,
      candidate.results,
      model,
    );

    return {
      model,
      in_baseline: inBaseline,
      in_candidate: inCandidate,
      baseline: baselineMetrics,
      candidate: candidateMetrics,
      score_delta,
      latency_delta_ms,
      error_rate_delta,
      cost_delta_usd,
      category_changes,
      new_failures,
      recovered,
      status_changes,
    };
  });

  const recommendation_change = {
    primary_changed:
      baseline.recommendation.primary_model !== candidate.recommendation.primary_model,
    baseline_primary: baseline.recommendation.primary_model,
    candidate_primary: candidate.recommendation.primary_model,
    fallback_changed:
      JSON.stringify(baseline.recommendation.fallback_models) !==
      JSON.stringify(candidate.recommendation.fallback_models),
    baseline_fallbacks: baseline.recommendation.fallback_models,
    candidate_fallbacks: candidate.recommendation.fallback_models,
  };

  const sharedComparisons = model_comparisons.filter((m) => m.in_baseline && m.in_candidate);
  const summary = {
    total_regressions: sharedComparisons.filter((m) => m.score_delta < 0).length,
    total_improvements: sharedComparisons.filter((m) => m.score_delta > 0).length,
    new_failure_count: model_comparisons.reduce((sum, m) => sum + m.new_failures.length, 0),
    recovered_count: model_comparisons.reduce((sum, m) => sum + m.recovered.length, 0),
  };

  return {
    schema_version: 'routebench.compare.v1',
    generated_at: now(),
    baseline: {
      started_at: baseline.started_at,
      finished_at: baseline.finished_at,
      models: baseline.models,
    },
    candidate: {
      started_at: candidate.started_at,
      finished_at: candidate.finished_at,
      models: candidate.models,
    },
    model_comparisons,
    recommendation_change,
    summary,
  };
}
