export function renderRouteExport(result, { baseUrl = '' } = {}) {
  const ranked = result.recommendation.ranked_models ?? [];
  return {
    schema_version: 'routebench.routing.v1',
    generated_at: result.finished_at,
    endpoint: baseUrl,
    primary_model: result.recommendation.primary_model ?? null,
    fallback_models: result.recommendation.fallback_models ?? [],
    routing_rules: ranked.map((model, index) => ({
      priority: index + 1,
      model: model.model,
      route_score: model.recommendation_score,
      overall_score: model.overall_score,
      avg_latency_ms: model.avg_latency_ms,
      error_rate: model.error_rate,
      reason: [model.score_reason, model.latency_reason, model.error_rate_reason].filter(Boolean).join(' '),
    })),
  };
}
