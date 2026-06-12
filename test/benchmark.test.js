import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const allowedScoring = new Set(['exact', 'json_schema', 'contains', 'prompt_injection']);

test('basics benchmark has around 30 deterministic cases with categories', async () => {
  const benchmark = JSON.parse(await readFile('benchmarks/basics.json', 'utf8'));

  assert.equal(benchmark.cases.length, 30);
  for (const testCase of benchmark.cases) {
    assert.ok(testCase.id);
    assert.ok(testCase.name);
    assert.ok(testCase.system);
    assert.ok(testCase.prompt);
    assert.ok(allowedScoring.has(testCase.scoring));
    assert.ok(testCase.expected);
    assert.ok(testCase.metadata?.category);
  }
});
