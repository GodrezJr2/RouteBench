import { sortDifficultyTiers } from './scoring.js';

function pct(errorRate) {
  return `${Math.round(errorRate * 100)}%`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function snippet(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function categoryBreakdown(results) {
  const groups = new Map();
  for (const row of results) {
    const key = `${row.model}|||${row.category ?? 'uncategorized'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [model, category] = key.split('|||');
    const avg = Math.round(rows.reduce((sum, row) => sum + Number(row.score ?? 0), 0) / rows.length);
    const failures = rows.filter((row) => row.status !== 'completed').length;
    return { model, category, avg, failures, count: rows.length };
  });
}

export function renderMarkdownReport(result) {
  const lines = [];
  lines.push('# RouteBench Report', '');
  lines.push(`- Schema: \`${result.schema_version}\``);
  lines.push(`- Started: ${result.started_at}`);
  lines.push(`- Finished: ${result.finished_at}`);
  lines.push(`- Models: ${result.models.map((model) => `\`${model}\``).join(', ')}`, '');

  lines.push('## Recommendation', '');
  lines.push(`Primary model: \`${result.recommendation.primary_model ?? 'none'}\``);
  lines.push(`Fallback order: ${result.recommendation.fallback_models.map((model) => `\`${model}\``).join(' → ') || 'none'}`);
  if (result.recommendation.confidence) {
    const repeatsNote = result.repeats > 1 ? ` (${result.repeats} runs per case)` : '';
    lines.push(`Confidence: **${result.recommendation.confidence}**${repeatsNote} — ${result.recommendation.confidence_reason}`);
  }
  lines.push('', result.recommendation.reason, '');

  const showStddev = result.recommendation.ranked_models.some((m) => m.score_stddev != null);
  lines.push('## Ranked Models', '');
  lines.push(`| Rank | Model | Route Score | Overall |${showStddev ? ' ±σ |' : ''} Avg Latency | P95 Latency | Error Rate | Est. Cost | Reasons |`);
  lines.push(`|---:|---|---:|---:|${showStddev ? '---:|' : ''}---:|---:|---:|---:|---|`);
  result.recommendation.ranked_models.forEach((model, index) => {
    const reasons = [model.score_reason, model.latency_reason, model.error_rate_reason].filter(Boolean).join(' ');
    const p95 = model.p95_latency_ms != null ? `${model.p95_latency_ms}ms` : '-';
    const cost = model.total_estimated_cost_usd != null ? `$${model.total_estimated_cost_usd.toFixed(6)}` : '-';
    const sigma = showStddev ? ` ±${model.score_stddev != null ? model.score_stddev : '-'} |` : '';
    lines.push(
      `| ${index + 1} | ${escapeCell(model.model)} | ${model.recommendation_score} | ${model.overall_score} |${sigma} ${model.avg_latency_ms}ms | ${p95} | ${pct(model.error_rate)} | ${cost} | ${escapeCell(reasons)} |`,
    );
  });
  lines.push('');

  // Token usage + prompt-cache hits. Only rendered when the provider reported
  // usage. A high cache-hit rate = cheaper repeat/long-session serving.
  const tokenModels = result.recommendation.ranked_models.filter((m) => m.total_prompt_tokens != null);
  if (tokenModels.length > 0) {
    lines.push('## Token Usage & Cache', '');
    lines.push('Prompt-cache hits make repeated context cheaper. High cache-hit rate = cost-efficient on long/repetitive sessions.', '');
    lines.push('| Model | Prompt | Cached | Cache Hit | Completion | Total |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const m of tokenModels) {
      const total = (m.total_prompt_tokens ?? 0) + (m.total_completion_tokens ?? 0);
      const hit = m.cache_hit_rate != null ? pct(m.cache_hit_rate) : '-';
      lines.push(
        `| ${escapeCell(m.model)} | ${m.total_prompt_tokens} | ${m.total_cached_tokens ?? 0} | ${hit} | ${m.total_completion_tokens} | ${total} |`,
      );
    }
    lines.push('');
  }

  const diagnosis = result.diagnosis ?? [];
  if (diagnosis.length > 0) {
    lines.push('## Diagnosis', '');
    for (const d of diagnosis) {
      lines.push(`- **${escapeCell(d.model)}** — ${escapeCell(d.text)}`);
    }
    lines.push('');
  }

  const categoryRouting = result.category_routing ?? [];
  if (categoryRouting.length > 0) {
    lines.push('## Per-Category Routing', '');
    lines.push('Best model per task category. Route each task type to its top model for task-based routing.', '');
    lines.push('| Category | Primary | Score | Error Rate | Avg Latency | Fallbacks |');
    lines.push('|---|---|---:|---:|---:|---|');
    for (const cat of categoryRouting) {
      const fallbacks = (cat.fallback_models ?? []).map((m) => `\`${m}\``).join(' → ') || 'none';
      lines.push(
        `| ${escapeCell(cat.category)} | \`${escapeCell(cat.primary_model ?? 'none')}\` | ${cat.best_score ?? '-'} | ${cat.error_rate != null ? pct(cat.error_rate) : '-'} | ${cat.avg_latency_ms ?? '-'}ms | ${fallbacks} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Category Breakdown', '');
  lines.push('| Model | Category | Avg Score | Failures | Cases |');
  lines.push('|---|---|---:|---:|---:|');
  for (const row of categoryBreakdown(result.results)) {
    lines.push(`| ${escapeCell(row.model)} | ${escapeCell(row.category)} | ${row.avg} | ${row.failures} | ${row.count} |`);
  }
  lines.push('');

  const difficultyAggregate = result.difficulty_aggregate ?? {};
  const tiers = sortDifficultyTiers(Object.keys(difficultyAggregate));
  if (tiers.length > 0) {
    lines.push('## Difficulty Breakdown', '');
    lines.push('How each model holds up as cases get harder — a high overall score can hide weakness on hard cases.', '');
    lines.push('| Difficulty | Model | Avg Score | Error Rate | Cases |');
    lines.push('|---|---|---:|---:|---:|');
    for (const tier of tiers) {
      const models = Object.values(difficultyAggregate[tier].models)
        .sort((a, b) => b.avg_score - a.avg_score || a.model.localeCompare(b.model));
      for (const m of models) {
        lines.push(`| ${escapeCell(tier)} | ${escapeCell(m.model)} | ${m.avg_score} | ${pct(m.error_rate)} | ${m.test_count} |`);
      }
    }
    lines.push('');
  }

  const languageAggregate = result.language_aggregate ?? {};
  const languages = Object.keys(languageAggregate).sort();
  if (languages.length > 0) {
    // Pivot: one row per model, one column per language, so a model's uneven
    // per-language strength ("aces Python, stumbles on Java") is visible at a glance.
    const modelSet = new Set();
    for (const lang of languages) {
      for (const m of Object.keys(languageAggregate[lang].models)) modelSet.add(m);
    }
    const scoreFor = (model, lang) => languageAggregate[lang].models[model]?.avg_score ?? null;
    const meanOf = (model) => {
      const vals = languages.map((l) => scoreFor(model, l)).filter((v) => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    };
    const models = [...modelSet].sort((a, b) => meanOf(b) - meanOf(a) || a.localeCompare(b));

    lines.push('## Per-Language Breakdown', '');
    lines.push('Strength by language — a model can ace one language and stumble on another. Cells are average scores; blank = no cases for that language.', '');
    lines.push(`| Model | ${languages.map(escapeCell).join(' | ')} |`);
    lines.push(`|---|${languages.map(() => '---:').join('|')}|`);
    for (const model of models) {
      const cells = languages.map((lang) => {
        const v = scoreFor(model, lang);
        return v == null ? '–' : String(v);
      });
      lines.push(`| ${escapeCell(model)} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  const failed = result.results.filter((row) => row.status !== 'completed' || row.passed === false);
  lines.push('## Failed Cases', '');
  if (failed.length === 0) {
    lines.push('No failed cases.', '');
  } else {
    lines.push('| Model | Case | Category | Status | Score | Latency | Error Type | Message | Failure Diagnosis | Output Snippet |');
    lines.push('|---|---|---|---|---:|---:|---|---|---|---|');
    for (const row of failed) {
      lines.push(
        `| ${escapeCell(row.model)} | ${escapeCell(row.test_case_id)} | ${escapeCell(row.category)} | ${escapeCell(row.status)} | ${row.score} | ${row.latency_ms}ms | ${escapeCell(row.error_type ?? '')} | ${escapeCell(row.error_message ?? row.score_reason ?? '')} | ${escapeCell(row.failure_diagnosis?.summary ?? '')} | ${escapeCell(snippet(row.output))} |`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
