import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { scoreCodeExec } from '../src/codeExec.js';

function has(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false });
    return !r.error && (r.status === 0 || (r.stdout + r.stderr).length > 0);
  } catch {
    return false;
  }
}
const hasPython = has('python', ['--version']);
const hasJava = has('javac', ['-version']) && has('java', ['-version']);

function tc(language, entry, cases) {
  return { scoring: 'code_exec', metadata: { language }, expected: { entry, cases } };
}

test('rejects an unsupported language', () => {
  const r = scoreCodeExec('x', tc('ruby', 'f', [{ args: [1], returns: 1 }]));
  assert.equal(r.score, 0);
  assert.match(r.reason, /unsupported language/);
});

test('rejects a case with no entry or cases', () => {
  const r = scoreCodeExec('x', { scoring: 'code_exec', metadata: { language: 'python' }, expected: {} });
  assert.equal(r.score, 0);
  assert.match(r.reason, /missing expected/);
});

test('python: correct solution scores 100', { skip: hasPython ? false : 'python not installed' }, () => {
  const r = scoreCodeExec('def add(a, b):\n    return a + b', tc('python', 'add', [
    { args: [2, 3], returns: 5 }, { args: [-1, 1], returns: 0 },
  ]));
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
});

test('python: wrong solution scores partial', { skip: hasPython ? false : 'python not installed' }, () => {
  const r = scoreCodeExec('def add(a, b):\n    return a - b', tc('python', 'add', [
    { args: [2, 3], returns: 5 }, { args: [0, 0], returns: 0 },
  ]));
  assert.equal(r.score, 50);
  assert.equal(r.passed, false);
});

test('python: extracts code from a fenced block', { skip: hasPython ? false : 'python not installed' }, () => {
  const r = scoreCodeExec('```python\ndef sq(n):\n    return n * n\n```', tc('python', 'sq', [
    { args: [4], returns: 16 },
  ]));
  assert.equal(r.score, 100);
});

test('java: correct int and int[] solutions score 100', { skip: hasJava ? false : 'java not installed' }, () => {
  const intR = scoreCodeExec('class Solution {\n  static int add(int a, int b) { return a + b; }\n}',
    tc('java', 'add', [{ args: [2, 3], returns: 5 }]));
  assert.equal(intR.score, 100);
  const arrR = scoreCodeExec('class Solution {\n  static int[] dbl(int[] a) {\n    int[] r = new int[a.length];\n    for (int i = 0; i < a.length; i++) r[i] = a[i] * 2;\n    return r;\n  }\n}',
    tc('java', 'dbl', [{ args: [[1, 2]], returns: [2, 4] }]));
  assert.equal(arrR.score, 100);
});

test('java: non-compiling code scores 0 with a compile reason', { skip: hasJava ? false : 'java not installed' }, () => {
  const r = scoreCodeExec('class Solution {\n  static int add(int a, int b) { return a + b }\n}',
    tc('java', 'add', [{ args: [2, 3], returns: 5 }]));
  assert.equal(r.score, 0);
  assert.match(r.reason, /did not compile/);
});
