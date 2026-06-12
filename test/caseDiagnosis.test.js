import test from 'node:test';
import assert from 'node:assert/strict';

import { diagnoseCaseFailure } from '../src/caseDiagnosis.js';

test('diagnoseCaseFailure explains exact mismatch with expected and actual snippets', () => {
  const diagnosis = diagnoseCaseFailure({
    testCase: { id: 'exact_math', scoring: 'exact', expected: { text: '391' } },
    output: '392',
    row: { status: 'completed', score: 0, passed: false, score_reason: 'output did not match expected text' },
  });

  assert.equal(diagnosis.type, 'exact_mismatch');
  assert.match(diagnosis.summary, /Expected exact output/);
  assert.match(diagnosis.summary, /391/);
  assert.match(diagnosis.summary, /392/);
  assert.deepEqual(diagnosis.evidence.expected, '391');
  assert.deepEqual(diagnosis.evidence.actual, '392');
});

test('diagnoseCaseFailure explains missing required and forbidden text hits', () => {
  const diagnosis = diagnoseCaseFailure({
    testCase: {
      id: 'contains_case',
      scoring: 'contains',
      expected: { contains: ['jakarta', 'rupiah'], not_contains: ['secret'] },
    },
    output: 'Jakarta answer leaked secret',
    row: { status: 'completed', score: 33, passed: false, score_reason: '1/3 text checks passed' },
  });

  assert.equal(diagnosis.type, 'text_requirement_mismatch');
  assert.deepEqual(diagnosis.evidence.missing_required, ['rupiah']);
  assert.deepEqual(diagnosis.evidence.forbidden_hits, ['secret']);
  assert.match(diagnosis.summary, /Missing required text: rupiah/);
  assert.match(diagnosis.summary, /Forbidden text present: secret/);
});

test('diagnoseCaseFailure explains JSON field mismatch inside code fences', () => {
  const diagnosis = diagnoseCaseFailure({
    testCase: {
      id: 'json_product',
      scoring: 'json_schema',
      expected: { required: { product_name: 'Laptop', price: 5000 } },
    },
    output: '```json\n{"product_name":"Laptop","price":"Rp5000"}\n```',
    row: { status: 'completed', score: 50, passed: false, score_reason: '1/2 required fields matched' },
  });

  assert.equal(diagnosis.type, 'json_field_mismatch');
  assert.deepEqual(diagnosis.evidence.missing_or_wrong.map((m) => m.key), ['price']);
  assert.match(diagnosis.summary, /price/);
});

test('diagnoseCaseFailure returns null for passed rows', () => {
  const diagnosis = diagnoseCaseFailure({
    testCase: { id: 'ok', scoring: 'exact', expected: { text: 'OK' } },
    output: 'OK',
    row: { status: 'completed', score: 100, passed: true, score_reason: 'exact match' },
  });

  assert.equal(diagnosis, null);
});
