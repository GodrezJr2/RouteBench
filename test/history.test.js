import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

import { openHistory, resultToHistoryEntry } from '../src/history.js';

function tmpDb() {
  return join(tmpdir(), `routebench-history-test-${process.pid}-${Math.floor(Math.random() * 1e9)}.db`);
}

function sampleResult(overrides = {}) {
  return {
    schema_version: 'routebench.phase0.v1',
    started_at: '2026-06-02T10:00:00.000Z',
    finished_at: '2026-06-02T10:05:00.000Z',
    models: ['model-a', 'model-b'],
    results: [],
    aggregate: {
      'model-a': { overall_score: 85, avg_latency_ms: 500, error_rate: 0, total_estimated_cost_usd: 0.01 },
      'model-b': { overall_score: 72, avg_latency_ms: 200, error_rate: 0.05, total_estimated_cost_usd: 0.001 },
    },
    recommendation: {
      primary_model: 'model-a',
      fallback_models: ['model-b'],
      ranked_models: [],
      reason: 'test',
    },
    ...overrides,
  };
}

test('openHistory creates and reopens db', () => {
  const path = tmpDb();
  const h1 = openHistory(path);
  assert.equal(h1.count(), 0);
  h1.close();
  const h2 = openHistory(path);
  assert.equal(h2.count(), 0);
  h2.close();
});

test('save and list runs', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const entry = resultToHistoryEntry(sampleResult(), { run_id: 'run-1', result_path: 'results/run-1.json' });
  h.save(entry);
  const runs = h.list();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].run_id, 'run-1');
  assert.equal(runs[0].primary_model, 'model-a');
  assert.deepEqual(runs[0].models, ['model-a', 'model-b']);
  assert.deepEqual(runs[0].fallback_models, ['model-b']);
  assert.equal(typeof runs[0].scores['model-a'], 'number');
  h.close();
});

test('resultToHistoryEntry extracts scores latency error_rate cost', () => {
  const entry = resultToHistoryEntry(sampleResult(), { run_id: 'r1', result_path: 'results/r1.json' });
  assert.equal(entry.scores['model-a'], 85);
  assert.equal(entry.scores['model-b'], 72);
  assert.equal(entry.avg_latency_ms['model-a'], 500);
  assert.equal(entry.error_rates['model-b'], 0.05);
  assert.equal(entry.costs['model-a'], 0.01);
  assert.ok(Math.abs(entry.total_cost - 0.011) < 0.0001);
});

test('resultToHistoryEntry does not include api_key', () => {
  const result = { ...sampleResult(), api_key: 'sk-secret', apiKey: 'sk-secret' };
  const entry = resultToHistoryEntry(result, { run_id: 'r1', result_path: 'results/r1.json' });
  const str = JSON.stringify(entry);
  assert.ok(!str.includes('sk-secret'));
  assert.ok(!('api_key' in entry));
});

test('get returns null for missing run', () => {
  const path = tmpDb();
  const h = openHistory(path);
  assert.equal(h.get('nonexistent'), null);
  h.close();
});

test('get returns saved run', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const entry = resultToHistoryEntry(sampleResult(), { run_id: 'run-42', result_path: 'results/x.json' });
  h.save(entry);
  const got = h.get('run-42');
  assert.ok(got);
  assert.equal(got.result_path, 'results/x.json');
  h.close();
});

test('hasPath returns true for existing result_path', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const entry = resultToHistoryEntry(sampleResult(), { run_id: 'run-p', result_path: 'results/p.json' });
  h.save(entry);
  assert.ok(h.hasPath('results/p.json'));
  assert.ok(!h.hasPath('results/missing.json'));
  h.close();
});

test('saveIfNew does not overwrite existing entry', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const e1 = resultToHistoryEntry(sampleResult(), { run_id: 'run-x', result_path: 'results/x.json', benchmark: 'pack-a' });
  h.save(e1);
  const e2 = resultToHistoryEntry(sampleResult(), { run_id: 'run-x', result_path: 'results/x.json', benchmark: 'pack-b' });
  h.saveIfNew(e2);
  assert.equal(h.get('run-x').benchmark, 'pack-a');
  h.close();
});

test('remove deletes entry', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const entry = resultToHistoryEntry(sampleResult(), { run_id: 'run-del', result_path: 'results/del.json' });
  h.save(entry);
  assert.equal(h.count(), 1);
  h.remove('run-del');
  assert.equal(h.count(), 0);
  assert.equal(h.get('run-del'), null);
  h.close();
});

test('list is ordered newest first', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const r1 = resultToHistoryEntry(sampleResult({ started_at: '2026-01-01T00:00:00Z' }), { run_id: 'old', result_path: 'results/old.json' });
  const r2 = resultToHistoryEntry(sampleResult({ started_at: '2026-06-01T00:00:00Z' }), { run_id: 'new', result_path: 'results/new.json' });
  h.save(r1); h.save(r2);
  const runs = h.list();
  assert.equal(runs[0].run_id, 'new');
  assert.equal(runs[1].run_id, 'old');
  h.close();
});

test('result_path normalised to forward slashes on save and lookup', () => {
  const path = tmpDb();
  const h = openHistory(path);
  const entry = resultToHistoryEntry(sampleResult(), { run_id: 'win', result_path: 'results\\win.json' });
  h.save(entry);
  // stored as forward slash; both slash styles resolve on lookup
  assert.ok(h.hasPath('results/win.json'));
  assert.ok(h.hasPath('results\\win.json'));
  assert.equal(h.get('win').result_path, 'results/win.json');
  h.close();
});
