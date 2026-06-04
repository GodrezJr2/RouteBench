import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreOutput } from '../src/scoring.js';

function exactCase(text) {
  return { scoring: 'exact', expected: { text } };
}
function containsCase(contains) {
  return { scoring: 'contains', expected: { contains } };
}

test('exact: identical output scores 100', () => {
  const r = scoreOutput('ACKNOWLEDGED', exactCase('ACKNOWLEDGED'));
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
  assert.equal(r.reason, 'exact match');
});

test('exact: trailing period earns near-match credit, not zero', () => {
  const r = scoreOutput('6.', exactCase('6'));
  assert.equal(r.score, 90);
  assert.equal(r.passed, true);
  assert.match(r.reason, /near match/);
});

test('exact: wrapping quotes earn near-match credit', () => {
  assert.equal(scoreOutput('"OK"', exactCase('OK')).score, 90);
  assert.equal(scoreOutput('`tac`', exactCase('tac')).score, 90);
  assert.equal(scoreOutput("'2,4,6'", exactCase('2,4,6')).score, 90);
});

test('exact: casing is still strict (uppercase transform stays meaningful)', () => {
  const r = scoreOutput('hello world', exactCase('HELLO WORLD'));
  assert.equal(r.score, 0);
  assert.equal(r.passed, false);
});

test('exact: added internal spaces still fail (no-spaces instruction)', () => {
  // "2, 4, 6" violates a "no spaces" instruction — must NOT be rewarded.
  assert.equal(scoreOutput('2, 4, 6', exactCase('2,4,6')).score, 0);
});

test('exact: a genuinely wrong answer still scores 0', () => {
  assert.equal(scoreOutput('banana', exactCase('6')).score, 0);
});

test('exact: empty expected does not near-match arbitrary punctuation', () => {
  assert.equal(scoreOutput('.', exactCase('')).score, 0);
});

test('contains: multi-word token matches across a newline', () => {
  const r = scoreOutput('It is a distributed version\ncontrol system.', containsCase(['version control']));
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
});

test('contains: double spaces inside a token still match', () => {
  const r = scoreOutput('bawa  perasaan', containsCase(['bawa perasaan']));
  assert.equal(r.score, 100);
});

test('contains: a missing token still scores partial/zero', () => {
  const r = scoreOutput('something unrelated', containsCase(['jakarta']));
  assert.equal(r.score, 0);
  assert.equal(r.passed, false);
});
