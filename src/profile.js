// Model Profile Card — fuses every RouteBench axis (overall quality, latency,
// tokens/cache, per-category, per-language, per-difficulty, and optional
// agentic repo-repair) into ONE per-model verdict with a role tag and
// use-for / avoid-for guidance. This is the layer that turns scattered numbers
// into a routing decision a human acts on.

// Pull a model's per-key score out of a {key:{models:{model:{avg_score}}}} map.
function perKeyScores(aggregateByKey, model) {
  const out = {};
  for (const [key, data] of Object.entries(aggregateByKey || {})) {
    const stats = data.models?.[model];
    if (stats && typeof stats.avg_score === 'number') out[key] = stats.avg_score;
  }
  return out;
}

function extremes(scoreMap) {
  const entries = Object.entries(scoreMap);
  if (entries.length === 0) return { strongest: null, weakest: null };
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  return { strongest: sorted[0], weakest: sorted[sorted.length - 1] };
}

function latencyClass(avgMs) {
  if (avgMs == null) return 'unknown';
  if (avgMs < 3000) return 'fast';
  if (avgMs < 8000) return 'moderate';
  return 'slow';
}

function qualityTier(score) {
  if (score >= 85) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
}

// Completion tokens per case — a proxy for verbosity (and thus cost/time).
function verbosityClass(completionTokens, testCount) {
  if (!completionTokens || !testCount) return 'unknown';
  const perCase = completionTokens / testCount;
  if (perCase > 600) return 'verbose';
  if (perCase > 250) return 'moderate';
  return 'terse';
}

function summarizeAgentic(rows, model) {
  const mine = (rows || []).filter((r) => r.model === model);
  if (mine.length === 0) return null;
  const solved = mine.filter((r) => r.passed);
  const solveRate = Number((solved.length / mine.length).toFixed(2));
  const avgTurns = solved.length
    ? Number((solved.reduce((s, r) => s + (r.turns_used ?? 0), 0) / solved.length).toFixed(1))
    : null;
  const avgOutTokens = mine.length
    ? Math.round(mine.reduce((s, r) => s + (r.usage?.completion_tokens ?? 0), 0) / mine.length)
    : null;
  const avgLatency = mine.length
    ? Math.round(mine.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / mine.length)
    : null;
  return { tasks: mine.length, solved: solved.length, solve_rate: solveRate, avg_turns: avgTurns, avg_out_tokens: avgOutTokens, avg_latency_ms: avgLatency };
}

// Role: a 2-factor verdict (quality tier × speed) nudged by per-axis spread.
function deriveRole({ quality, latency, languages, agentic }) {
  const tier = qualityTier(quality);
  const fast = latency === 'fast' || latency === 'moderate';
  const langScores = Object.values(languages || {});
  const unevenLang = langScores.length >= 2 && Math.max(...langScores) - Math.min(...langScores) >= 20;
  const agenticWeak = agentic && agentic.solve_rate < 0.6;

  if (tier === 'low') return 'LIMITED';
  if (agenticWeak && tier !== 'high') return 'SPECIALIST';
  if (tier === 'high' && unevenLang) return 'SPECIALIST';
  if (tier === 'high' && fast) return 'DAILY DRIVER';
  if (tier === 'high' && !fast) return 'HEAVY CODER';
  return 'SPECIALIST';
}

function deriveUseFor(p) {
  const out = [];
  const strongCats = Object.entries(p.categories).filter(([, s]) => s >= 90).map(([c]) => c);
  if (strongCats.length) out.push(`Tasks: ${strongCats.slice(0, 3).join(', ')}`);
  const strongLangs = Object.entries(p.languages).filter(([, s]) => s >= 90).map(([l]) => l);
  if (strongLangs.length) out.push(`Languages: ${strongLangs.join(', ')}`);
  if (p.latency_class === 'fast') out.push('Latency-sensitive / interactive use');
  if (p.agentic && p.agentic.solve_rate >= 0.8 && (p.agentic.avg_turns ?? 9) <= 2) out.push('Multi-step repo / agentic work');
  if (p.tokens.verbosity_class === 'terse') out.push('High-volume / token-budget-sensitive work');
  if (out.length === 0) out.push('General use within its quality tier');
  return out;
}

function deriveAvoidFor(p) {
  const out = [];
  const weakLangs = Object.entries(p.languages).filter(([, s]) => s < 80).map(([l]) => `${l} (${Math.round(perScore(p.languages, l))})`);
  if (weakLangs.length) out.push(`Weak languages: ${weakLangs.join(', ')}`);
  const weakCats = Object.entries(p.categories).filter(([, s]) => s < 70).map(([c]) => c);
  if (weakCats.length) out.push(`Weak tasks: ${weakCats.slice(0, 3).join(', ')}`);
  if (p.latency_class === 'slow') out.push('Interactive / latency-sensitive use (slow)');
  if (p.tokens.verbosity_class === 'verbose') out.push('Tight token budgets (verbose output)');
  if (p.agentic && p.agentic.solve_rate < 0.6) out.push('Complex multi-file / agentic tasks');
  if (p.difficulty.degrades) out.push('Hardest-tier problems (quality drops on hard cases)');
  if (out.length === 0) out.push('No notable weaknesses in this run');
  return out;
}

function perScore(map, key) {
  return map[key];
}

export function buildProfiles(result, agenticRows = null) {
  const models = result.aggregate?.models ?? {};
  const profiles = [];
  for (const [model, agg] of Object.entries(models)) {
    const categories = perKeyScores(result.category_aggregate, model);
    const languages = perKeyScores(result.language_aggregate, model);
    const difficulty = perKeyScores(result.difficulty_aggregate, model);
    const degrades = difficulty.easy != null && difficulty.hard != null && difficulty.easy - difficulty.hard >= 15;
    const lat = latencyClass(agg.avg_latency_ms);
    const tokens = {
      completion: agg.total_completion_tokens ?? null,
      cached: agg.total_cached_tokens ?? null,
      cache_hit_rate: agg.cache_hit_rate ?? null,
      verbosity_class: verbosityClass(agg.total_completion_tokens, agg.test_count),
    };
    const agentic = summarizeAgentic(agenticRows, model);

    const base = {
      model,
      overall_score: agg.overall_score,
      quality_tier: qualityTier(agg.overall_score),
      avg_latency_ms: agg.avg_latency_ms,
      p95_latency_ms: agg.p95_latency_ms,
      latency_class: lat,
      error_rate: agg.error_rate,
      tokens,
      categories,
      languages,
      difficulty: { ...difficulty, degrades },
      agentic,
      strongest_language: extremes(languages).strongest,
      weakest_language: extremes(languages).weakest,
    };
    base.role = deriveRole({ quality: agg.overall_score, latency: lat, languages, agentic });
    base.use_for = deriveUseFor(base);
    base.avoid_for = deriveAvoidFor(base);
    profiles.push(base);
  }
  profiles.sort((a, b) => b.overall_score - a.overall_score || a.avg_latency_ms - b.avg_latency_ms);
  return profiles;
}

function fmtPair(pair) {
  return pair ? `${pair[0]} (${pair[1]})` : '–';
}

function langLine(languages) {
  const entries = Object.entries(languages);
  if (entries.length === 0) return '–';
  return entries.sort((a, b) => b[1] - a[1]).map(([l, s]) => `${l} ${s}`).join(' · ');
}

export function renderProfileReport(profiles, { title = 'RouteBench Model Profiles', generatedAt = null } = {}) {
  const lines = [];
  lines.push(`# ${title}`, '');
  if (generatedAt) lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Models profiled: ${profiles.length}`, '');
  lines.push('One fused verdict per model — quality, speed, tokens, per-language and per-task strength, and (if available) agentic repo-repair — distilled into a role and use/avoid guidance.', '');

  lines.push('## Summary', '');
  lines.push('| Model | Role | Overall | Latency | Languages | Verbosity | Agentic |');
  lines.push('|---|---|---:|---|---|---|---|');
  for (const p of profiles) {
    const langs = Object.keys(p.languages).length ? langLine(p.languages) : '–';
    const ag = p.agentic ? `${Math.round(p.agentic.solve_rate * 100)}% solved` : '–';
    lines.push(`| ${p.model} | **${p.role}** | ${p.overall_score} | ${p.latency_class} (${p.avg_latency_ms}ms) | ${langs} | ${p.tokens.verbosity_class} | ${ag} |`);
  }
  lines.push('');

  for (const p of profiles) {
    lines.push(`## ${p.model}`, '');
    lines.push(`**Role: ${p.role}**  ·  Overall ${p.overall_score}  ·  ${p.latency_class} latency (${p.avg_latency_ms}ms avg, ${p.p95_latency_ms}ms p95)  ·  errors ${Math.round((p.error_rate ?? 0) * 100)}%`, '');
    if (Object.keys(p.languages).length) {
      lines.push(`- Per-language: ${langLine(p.languages)}  (strongest ${fmtPair(p.strongest_language)}, weakest ${fmtPair(p.weakest_language)})`);
    }
    const catStr = Object.entries(p.categories).sort((a, b) => b[1] - a[1]).map(([c, s]) => `${c} ${s}`).join(' · ');
    if (catStr) lines.push(`- Per-task: ${catStr}`);
    const diff = p.difficulty;
    if (diff.easy != null || diff.medium != null || diff.hard != null) {
      lines.push(`- By difficulty: easy ${diff.easy ?? '–'} · medium ${diff.medium ?? '–'} · hard ${diff.hard ?? '–'}${diff.degrades ? '  ⚠ degrades on hard' : ''}`);
    }
    if (p.tokens.completion != null) {
      const cache = p.tokens.cache_hit_rate != null ? `, cache hit ${Math.round(p.tokens.cache_hit_rate * 100)}%` : '';
      lines.push(`- Tokens: ${p.tokens.completion} completion (${p.tokens.verbosity_class}${cache})`);
    }
    if (p.agentic) {
      lines.push(`- Agentic: solved ${p.agentic.solved}/${p.agentic.tasks} (${Math.round(p.agentic.solve_rate * 100)}%), avg ${p.agentic.avg_turns ?? '–'} turns, ${p.agentic.avg_out_tokens ?? '–'} out-tokens/task`);
    }
    lines.push('');
    lines.push('**Use for:**');
    for (const u of p.use_for) lines.push(`- ${u}`);
    lines.push('');
    lines.push('**Avoid for:**');
    for (const a of p.avoid_for) lines.push(`- ${a}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// ── Dashboard payload ──────────────────────────────────────────────────────
// Transform a benchmark result (+ optional agentic rows) into the exact shape
// the visual dashboard (src/dashboard.html) renders. Keeps all derivation
// server-side so the client just paints.

const ROLE_CLASS = { 'DAILY DRIVER': 'daily', 'HEAVY CODER': 'heavy', SPECIALIST: 'spec', LIMITED: 'limited' };
const ROLE_COLOR = { daily: 'var(--accent)', heavy: 'var(--blue)', spec: 'var(--amber)', limited: 'var(--red)' };

function fmtMs(ms) {
  if (ms == null) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
function fmtPct(rate) {
  if (rate == null) return '–';
  return `${Math.round(rate * 100)}%`;
}
function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function verbosity(completion, testCount) {
  if (!completion || !testCount) return 'moderate';
  const perCase = completion / testCount;
  if (perCase > 600) return 'verbose';
  if (perCase > 250) return 'moderate';
  return 'terse';
}

export function buildDashboard(result, agenticRows = null) {
  const models = result.aggregate?.models ?? {};
  const profiles = buildProfiles(result, agenticRows);

  // Profile cards
  const cards = profiles.map((p) => {
    const roleCls = ROLE_CLASS[p.role] || 'spec';
    const weak = p.weakest_language && Object.keys(p.languages).length && p.weakest_language[1] < 90
      ? `${p.weakest_language[0]} ${p.weakest_language[1]}` : null;
    return {
      model: p.model, role: p.role, roleCls, color: ROLE_COLOR[roleCls],
      overall: p.overall_score, latency: fmtMs(p.avg_latency_ms), weak,
      use: (p.use_for || []).slice(0, 2), avoid: (p.avoid_for || []).slice(0, 2),
    };
  });

  // Per-language matrix
  const langAgg = result.language_aggregate ?? {};
  const langKeys = Object.keys(langAgg).sort();
  const langModels = [...new Set(langKeys.flatMap((k) => Object.keys(langAgg[k].models)))]
    .sort((a, b) => (models[b]?.overall_score ?? 0) - (models[a]?.overall_score ?? 0));
  const languages = langKeys.length === 0 ? null : {
    cols: langKeys.map(titleCase),
    rows: langModels.map((m) => ({ model: m, s: langKeys.map((k) => langAgg[k].models[m]?.avg_score ?? null) })),
  };

  // Ranked
  const ranked = (result.recommendation?.ranked_models ?? []).map((m) => ({
    model: m.model, route: m.recommendation_score, overall: m.overall_score,
    avg: fmtMs(m.avg_latency_ms), p95: m.p95_latency_ms != null ? fmtMs(m.p95_latency_ms) : '–', err: fmtPct(m.error_rate),
  }));

  // Category + difficulty (mean across models per bucket)
  const meanByKey = (agg) => Object.entries(agg || {}).map(([n, d]) => {
    const vals = Object.values(d.models).map((x) => x.avg_score);
    return { n, s: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
  });
  const categories = meanByKey(result.category_aggregate).sort((a, b) => b.s - a.s);
  const DIFF_ORDER = { easy: 0, medium: 1, hard: 2 };
  const difficulty = meanByKey(result.difficulty_aggregate).sort((a, b) => (DIFF_ORDER[a.n] ?? 9) - (DIFF_ORDER[b.n] ?? 9));

  // Tokens
  const tokens = Object.values(models)
    .filter((m) => m.total_completion_tokens != null)
    .map((m) => ({ model: m.model, tok: m.total_completion_tokens, note: verbosity(m.total_completion_tokens, m.test_count) }))
    .sort((a, b) => b.tok - a.tok);

  // Agentic (optional) — only models that are also in this benchmark run, so
  // the panel stays coherent with the rest of the dashboard.
  let agentic = null;
  const agenticForRun = Array.isArray(agenticRows) ? agenticRows.filter((r) => models[r.model]) : [];
  if (agenticForRun.length) {
    const taskIds = [...new Set(agenticForRun.map((r) => r.task_id))];
    const byModel = {};
    for (const r of agenticForRun) { (byModel[r.model] ||= {})[r.task_id] = r; }
    agentic = {
      tasks: taskIds.map((t) => t.replace(/_\d+$/, '').replace(/_/g, '-')),
      rows: Object.entries(byModel).map(([model, tasks]) => {
        const vals = Object.values(tasks);
        return {
          model,
          r: taskIds.map((t) => tasks[t] ? { pass: !!tasks[t].passed, turns: tasks[t].turns_used ?? 0 } : { pass: false, turns: 0 }),
          tok: Math.round(vals.reduce((s, x) => s + (x.usage?.completion_tokens ?? 0), 0) / vals.length),
          lat: fmtMs(Math.round(vals.reduce((s, x) => s + (x.latency_ms ?? 0), 0) / vals.length)),
        };
      }),
    };
  }

  // Derived verdict
  const overalls = Object.values(models).map((m) => m.overall_score).filter((n) => n != null);
  const lats = Object.values(models).map((m) => m.avg_latency_ms).filter((n) => n != null);
  const verdict = [];
  if (overalls.length) {
    const lo = Math.min(...overalls), hi = Math.max(...overalls);
    verdict.push({ n: lo === hi ? String(hi) : `${lo}–${hi}`, l: 'overall score range across models', cls: 'tA' });
  }
  verdict.push({ n: String(Object.keys(models).length), l: 'models profiled' });
  if (lats.length) {
    const spread = Math.max(...lats) / Math.max(1, Math.min(...lats));
    verdict.push({ n: `${spread.toFixed(1)}×`, l: 'latency spread, slowest vs fastest', cls: 'tW' });
  }

  return {
    meta: { models: result.models ?? Object.keys(models), finished_at: result.finished_at ?? null, cases: (result.test_cases ?? []).length },
    verdict, profiles: cards, languages, agentic, ranked, categories, difficulty, tokens,
  };
}
