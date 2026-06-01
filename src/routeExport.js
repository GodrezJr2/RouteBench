export function validateRouteExport(json) {
  const errors = [];
  if (json?.schema_version !== 'routebench.routing.v1') errors.push('schema_version must be "routebench.routing.v1"');
  if (typeof json?.generated_at !== 'string') errors.push('generated_at must be a string');
  if (typeof json?.endpoint !== 'string') errors.push('endpoint must be a string');
  if (!Array.isArray(json?.routing_rules)) errors.push('routing_rules must be an array');
  else {
    for (const [i, rule] of json.routing_rules.entries()) {
      if (typeof rule.model !== 'string') errors.push(`routing_rules[${i}].model must be a string`);
      if (!Number.isFinite(rule.priority)) errors.push(`routing_rules[${i}].priority must be a number`);
      if (!Number.isFinite(rule.route_score)) errors.push(`routing_rules[${i}].route_score must be a number`);
    }
  }
  return { valid: errors.length === 0, errors };
}

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
