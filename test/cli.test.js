import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, createSampleResult, formatModelsList } from '../src/cliCore.js';

test('parses output and benchmark flags', () => {
  const parsed = parseArgs(['run', '--benchmark', 'benchmarks/basics.json', '--output', 'results/out.json']);

  assert.equal(parsed.command, 'run');
  assert.equal(parsed.flags.benchmark, 'benchmarks/basics.json');
  assert.equal(parsed.flags.output, 'results/out.json');
});

test('sample result compares at least two demo models', async () => {
  const sample = await createSampleResult();

  assert.ok(sample.models.length >= 2);
  assert.ok(sample.results.length >= sample.models.length);
  assert.ok(sample.recommendation.primary_model);
  assert.ok(sample.aggregate.models[sample.recommendation.primary_model]);
});

test('formats discovered model list for terminal output', () => {
  const text = formatModelsList({ models: [{ id: 'ComboOP', owned_by: 'combo' }] });

  assert.match(text, /Discovered 1 model/);
  assert.match(text, /ComboOP/);
  assert.match(text, /combo/);
});
