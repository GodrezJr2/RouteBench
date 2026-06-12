import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProfiles, renderProfileReport, buildDashboard, mergeResults } from '../src/profile.js';

function fixture() {
  return {
    finished_at: '2026-01-01T00:00:00Z',
    aggregate: {
      models: {
        fast_good: { overall_score: 92, avg_latency_ms: 2000, p95_latency_ms: 3000, error_rate: 0, test_count: 10, total_completion_tokens: 800, total_cached_tokens: 0, cache_hit_rate: 0 },
        slow_good: { overall_score: 90, avg_latency_ms: 20000, p95_latency_ms: 40000, error_rate: 0, test_count: 10, total_completion_tokens: 9000, total_cached_tokens: 0, cache_hit_rate: 0 },
        uneven: { overall_score: 88, avg_latency_ms: 4000, p95_latency_ms: 8000, error_rate: 0, test_count: 12, total_completion_tokens: 2000 },
        weak: { overall_score: 60, avg_latency_ms: 3000, p95_latency_ms: 5000, error_rate: 0, test_count: 10, total_completion_tokens: 1000 },
      },
    },
    category_aggregate: {
      algo: { models: { fast_good: { avg_score: 95 }, uneven: { avg_score: 90 } } },
    },
    language_aggregate: {
      python: { models: { fast_good: { avg_score: 95 }, uneven: { avg_score: 100 } } },
      java: { models: { uneven: { avg_score: 60 } } },
    },
    difficulty_aggregate: {
      easy: { models: { slow_good: { avg_score: 100 } } },
      hard: { models: { slow_good: { avg_score: 70 } } },
    },
  };
}

test('high quality + fast latency → DAILY DRIVER', () => {
  const p = buildProfiles(fixture()).find((x) => x.model === 'fast_good');
  assert.equal(p.role, 'DAILY DRIVER');
  assert.equal(p.latency_class, 'fast');
});

test('high quality + slow latency → HEAVY CODER, flags difficulty degradation', () => {
  const p = buildProfiles(fixture()).find((x) => x.model === 'slow_good');
  assert.equal(p.role, 'HEAVY CODER');
  assert.equal(p.difficulty.degrades, true);
  assert.ok(p.avoid_for.some((a) => /hard/i.test(a)));
  assert.ok(p.avoid_for.some((a) => /slow|latency/i.test(a)));
});

test('uneven per-language strength → SPECIALIST, weakest language flagged', () => {
  const p = buildProfiles(fixture()).find((x) => x.model === 'uneven');
  assert.equal(p.role, 'SPECIALIST');
  assert.deepEqual(p.weakest_language, ['java', 60]);
  assert.ok(p.avoid_for.some((a) => /java/i.test(a)));
});

test('low overall score → LIMITED', () => {
  const p = buildProfiles(fixture()).find((x) => x.model === 'weak');
  assert.equal(p.role, 'LIMITED');
});

test('verbose models get a tight-token-budget warning', () => {
  const p = buildProfiles(fixture()).find((x) => x.model === 'slow_good');
  assert.equal(p.tokens.verbosity_class, 'verbose');
  assert.ok(p.avoid_for.some((a) => /token budget/i.test(a)));
});

test('agentic rows enrich the matching model only', () => {
  const rows = [
    { model: 'fast_good', passed: true, turns_used: 1, latency_ms: 1000, usage: { completion_tokens: 200 } },
    { model: 'fast_good', passed: false, turns_used: 5, latency_ms: 5000, usage: { completion_tokens: 900 } },
  ];
  const profiles = buildProfiles(fixture(), rows);
  const enriched = profiles.find((x) => x.model === 'fast_good');
  const bare = profiles.find((x) => x.model === 'uneven');
  assert.equal(enriched.agentic.tasks, 2);
  assert.equal(enriched.agentic.solved, 1);
  assert.equal(enriched.agentic.solve_rate, 0.5);
  assert.equal(bare.agentic, null);
});

test('profiles sort by overall score descending', () => {
  const profiles = buildProfiles(fixture());
  const scores = profiles.map((p) => p.overall_score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('renderProfileReport emits a card and role per model', () => {
  const md = renderProfileReport(buildProfiles(fixture()), { generatedAt: 'now' });
  assert.match(md, /## fast_good/);
  assert.match(md, /Role: DAILY DRIVER/);
  assert.match(md, /Use for:/);
  assert.match(md, /Avoid for:/);
});

function runFixture() {
  return {
    models: ['m1', 'm2'],
    finished_at: '2026-01-01T00:00:00Z',
    test_cases: [{ id: 'a' }, { id: 'b' }],
    aggregate: { models: {
      m1: { model: 'm1', overall_score: 95, avg_latency_ms: 2000, p95_latency_ms: 3000, error_rate: 0, test_count: 4, total_completion_tokens: 400 },
      m2: { model: 'm2', overall_score: 80, avg_latency_ms: 8000, p95_latency_ms: 12000, error_rate: 0, test_count: 4, total_completion_tokens: 4000 },
    } },
    recommendation: { ranked_models: [
      { model: 'm1', recommendation_score: 95, overall_score: 95, avg_latency_ms: 2000, p95_latency_ms: 3000, error_rate: 0 },
      { model: 'm2', recommendation_score: 80, overall_score: 80, avg_latency_ms: 8000, p95_latency_ms: 12000, error_rate: 0 },
    ] },
    category_aggregate: { algo: { models: { m1: { avg_score: 95 }, m2: { avg_score: 80 } } } },
    language_aggregate: {
      python: { models: { m1: { avg_score: 100 }, m2: { avg_score: 100 } } },
      java: { models: { m1: { avg_score: 100 }, m2: { avg_score: 60 } } },
    },
    difficulty_aggregate: { easy: { models: { m1: { avg_score: 100 } } }, hard: { models: { m1: { avg_score: 90 } } } },
  };
}

test('buildDashboard produces the full payload shape', () => {
  const d = buildDashboard(runFixture());
  assert.deepEqual(Object.keys(d).sort(), ['agentic', 'categories', 'difficulty', 'languages', 'meta', 'profiles', 'ranked', 'tokens', 'verdict'].sort());
  assert.equal(d.profiles.length, 2);
  assert.equal(d.ranked[0].model, 'm1');
  assert.match(d.ranked[0].avg, /2\.0s|2000ms/);
});

test('buildDashboard maps role to a css class and color', () => {
  const d = buildDashboard(runFixture());
  const m1 = d.profiles.find((p) => p.model === 'm1');
  assert.ok(['daily', 'heavy', 'spec', 'limited'].includes(m1.roleCls));
  assert.match(m1.color, /var\(--/);
});

test('buildDashboard builds a per-language matrix sorted by overall', () => {
  const d = buildDashboard(runFixture());
  assert.deepEqual(d.languages.cols, ['Java', 'Python']);
  assert.equal(d.languages.rows[0].model, 'm1'); // higher overall first
});

test('buildDashboard derives a verdict and token list', () => {
  const d = buildDashboard(runFixture());
  assert.equal(d.verdict[0].n, '80–95');
  assert.equal(d.verdict[1].n, '2');
  assert.equal(d.tokens[0].model, 'm2'); // most verbose first
  assert.equal(d.tokens[0].note, 'verbose');
});

test('buildDashboard filters agentic rows to this run\'s models', () => {
  const rows = [
    { model: 'm1', task_id: 'cart_repair_001', passed: true, turns_used: 1, latency_ms: 1000, usage: { completion_tokens: 200 } },
    { model: 'other', task_id: 'cart_repair_001', passed: true, turns_used: 1, latency_ms: 1000, usage: { completion_tokens: 200 } },
  ];
  const d = buildDashboard(runFixture(), rows);
  assert.equal(d.agentic.rows.length, 1);
  assert.equal(d.agentic.rows[0].model, 'm1');
  assert.equal(d.agentic.rows[0].r[0].pass, true);
});

test('buildDashboard omits languages + agentic when absent', () => {
  const r = runFixture();
  delete r.language_aggregate;
  const d = buildDashboard(r, null);
  assert.equal(d.languages, null);
  assert.equal(d.agentic, null);
});

test('mergeResults fuses models and axes across runs (latest wins)', () => {
  const langRun = {
    finished_at: '2026-02-01T00:00:00Z',
    models: ['a'],
    test_cases: [{ id: 'x1' }, { id: 'x2' }],
    aggregate: { models: { a: { model: 'a', overall_score: 80, avg_latency_ms: 1000, error_rate: 0 } } },
    language_aggregate: { python: { models: { a: { avg_score: 100 } } } },
  };
  const catRun = {
    finished_at: '2026-03-01T00:00:00Z',
    models: ['a', 'b'],
    test_cases: [{ id: 'y1' }],
    aggregate: {
      models: {
        a: { model: 'a', overall_score: 90, avg_latency_ms: 2000, error_rate: 0 },
        b: { model: 'b', overall_score: 70, avg_latency_ms: 500, error_rate: 0 },
      },
    },
    category_aggregate: { coding: { models: { a: { avg_score: 88 }, b: { avg_score: 60 } } } },
  };
  const m = mergeResults([catRun, langRun]); // pass out of order on purpose
  assert.equal(m.merged, true);
  assert.equal(m.run_count, 2);
  assert.deepEqual(m.models.sort(), ['a', 'b']);
  // latest run (catRun, March) wins for a's core metrics
  assert.equal(m.aggregate.models.a.overall_score, 90);
  // languages survive from the earlier polyglot run, categories from the later one
  assert.equal(m.language_aggregate.python.models.a.avg_score, 100);
  assert.equal(m.category_aggregate.coding.models.a.avg_score, 88);
  // distinct case ids across both runs
  assert.equal(m.test_cases.length, 3);
  // ranked is sorted by overall desc and a model-only-in-one-run is included
  assert.equal(m.recommendation.ranked_models[0].model, 'a');
  assert.ok(m.recommendation.ranked_models.some((r) => r.model === 'b'));
  // feeds buildDashboard cleanly
  const d = buildDashboard(m, null);
  assert.equal(d.meta.merged, true);
  assert.equal(d.profiles.length, 2);
});
