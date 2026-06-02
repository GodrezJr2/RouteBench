// Natural-language diagnosis generator. Turns the numeric aggregates into a
// short per-model strengths/weaknesses summary. It must never hide weak scores
// — bad categories and error rates are stated plainly so users can audit.

function scoreBand(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Usable';
  if (score >= 60) return 'Weak';
  return 'Poor';
}

function prettyCategory(category) {
  return String(category).replace(/_/g, ' ');
}

function latencySentence(model) {
  const avg = model.avg_latency_ms;
  const p95 = model.p95_latency_ms;
  const tail = p95 != null ? ` (p95 ${p95}ms)` : '';
  if (avg == null) return '';
  if (avg <= 2000) return `Fast — average ${avg}ms${tail}.`;
  if (avg <= 8000) return `Moderate latency — average ${avg}ms${tail}.`;
  return `Slow — average ${avg}ms${tail}.`;
}

// Build one diagnosis entry per model.
export function generateDiagnosis({ aggregate, categoryAggregate = {}, categoryRouting = [] }) {
  const models = Object.values(aggregate?.models ?? {});
  return models.map((model) => {
    const id = model.model;

    // Per-category scores for this model.
    const catScores = [];
    for (const [category, data] of Object.entries(categoryAggregate)) {
      const stat = data.models?.[id];
      if (stat) catScores.push({ category, score: stat.avg_score });
    }
    catScores.sort((a, b) => b.score - a.score);

    const strengths = catScores.filter((c) => c.score >= 80);
    const weaknesses = catScores.filter((c) => c.score < 70);
    const primaryFor = categoryRouting
      .filter((rule) => rule.primary_model === id)
      .map((rule) => rule.category);

    const parts = [];
    parts.push(`${scoreBand(model.overall_score)} overall (${model.overall_score}).`);

    if (strengths.length > 0) {
      parts.push(
        `Strong on ${strengths.slice(0, 3).map((c) => `${prettyCategory(c.category)} (${c.score})`).join(', ')}.`,
      );
    }
    if (weaknesses.length > 0) {
      parts.push(
        `Weak on ${weaknesses.slice(0, 3).map((c) => `${prettyCategory(c.category)} (${c.score})`).join(', ')}.`,
      );
    }

    const latency = latencySentence(model);
    if (latency) parts.push(latency);

    if (model.error_rate > 0) {
      const pct = Math.round(model.error_rate * 100);
      parts.push(`Unreliable: ${pct}% of requests failed.`);
    } else {
      parts.push('No failed requests.');
    }

    if (model.total_estimated_cost_usd != null) {
      parts.push(`Estimated cost $${model.total_estimated_cost_usd.toFixed(6)} for this run.`);
    }

    if (primaryFor.length > 0) {
      parts.push(`Best used as primary for ${primaryFor.map(prettyCategory).join(', ')}.`);
    } else {
      parts.push('Not the top pick for any task category here.');
    }

    return {
      model: id,
      overall_score: model.overall_score,
      band: scoreBand(model.overall_score),
      strengths: strengths.map((c) => c.category),
      weaknesses: weaknesses.map((c) => c.category),
      primary_for: primaryFor,
      text: parts.join(' '),
    };
  });
}
