import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractCode } from './extractCode.js';

// Multi-language execution scorer. Runs model-generated Python / Java /
// JavaScript against declared unit-test cases in a throwaway temp dir and
// returns a pass-ratio score. This is what lets RouteBench profile a model
// per language ("good at Python, so-so at Java") with REAL pass/fail, not just
// reasoning about code.
//
// Case shape (same as code_unit_test, plus metadata.language):
//   scoring: "code_exec"
//   metadata.language: "python" | "java" | "javascript"
//   expected.entry: function/method name to call
//   expected.cases: [{ args: [...], returns: <json> }]
//
// SECURITY: model code runs via the real language runtime (python/javac+java/
// node) with spawnSync (args array, no shell) and a hard timeout in an isolated
// temp dir. Not a hardened sandbox — local-benchmark trust level only, the same
// as the vm-based code_unit_test scorer. Do not run untrusted models with
// secrets on the machine.

function mkTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'routebench-exec-'));
}

function parseResult(stdout) {
  const m = String(stdout).match(/__RESULT__\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

// ---- Python ---------------------------------------------------------------
function runPython(code, entry, cases, timeoutMs) {
  const harness = [
    code,
    '',
    'import json as __json',
    `__cases = __json.loads(${JSON.stringify(JSON.stringify(cases))})`,
    '__p = 0',
    'for __c in __cases:',
    '    try:',
    `        __g = ${entry}(*__c["args"])`,
    '        if __json.dumps(__g, sort_keys=True) == __json.dumps(__c["returns"], sort_keys=True):',
    '            __p += 1',
    '    except Exception:',
    '        pass',
    'print("__RESULT__", __p)',
    '',
  ].join('\n');
  const dir = mkTemp();
  try {
    const file = path.join(dir, 'solution.py');
    fs.writeFileSync(file, harness);
    const res = spawnSync('python', [file], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: false });
    return { passed: parseResult(res.stdout), stderr: res.stderr, error: res.error };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ---- JavaScript (subprocess; node:vm path stays in code_unit_test) ---------
function runJavaScript(code, entry, cases, timeoutMs) {
  const harness = [
    code,
    '',
    `const __cases = ${JSON.stringify(cases)};`,
    'let __p = 0;',
    'for (const __c of __cases) {',
    '  try {',
    `    const __g = ${entry}(...(__c.args || []));`,
    '    if (JSON.stringify(__g) === JSON.stringify(__c.returns)) __p++;',
    '  } catch (e) {}',
    '}',
    'console.log("__RESULT__", __p);',
    '',
  ].join('\n');
  const dir = mkTemp();
  try {
    const file = path.join(dir, 'solution.mjs');
    fs.writeFileSync(file, harness);
    const res = spawnSync('node', [file], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: false });
    return { passed: parseResult(res.stdout), stderr: res.stderr, error: res.error };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ---- Java -----------------------------------------------------------------
// Inference-based literal rendering for a constrained-but-useful type set:
// int, boolean, String, and int[]. Covers most algorithm signatures.
function toJavaLiteral(v) {
  if (Array.isArray(v)) {
    if (v.every((x) => Number.isInteger(x))) return `new int[]{${v.join(',')}}`;
    throw new Error('java: only int[] arrays supported');
  }
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`java: unsupported value type ${typeof v}`);
}

function runJava(code, entry, cases, timeoutMs) {
  let checks;
  try {
    checks = cases.map((c) => {
      const args = (c.args || []).map(toJavaLiteral).join(', ');
      const ret = toJavaLiteral(c.returns);
      return `    try { if (eq(Solution.${entry}(${args}), ${ret})) p++; } catch (Throwable e) {}`;
    }).join('\n');
  } catch (e) {
    return { passed: null, stderr: e.message, error: { code: 'UNSUPPORTED_JAVA_TYPE' } };
  }
  const main = [
    'import java.util.*;',
    'public class Main {',
    '  static boolean eq(Object a, Object b) {',
    '    if (a instanceof int[] && b instanceof int[]) return Arrays.equals((int[]) a, (int[]) b);',
    '    return a == null ? b == null : a.equals(b);',
    '  }',
    '  public static void main(String[] args) {',
    '    int p = 0;',
    checks,
    '    System.out.println("__RESULT__ " + p);',
    '  }',
    '}',
    '',
  ].join('\n');
  const dir = mkTemp();
  try {
    fs.writeFileSync(path.join(dir, 'Solution.java'), code);
    fs.writeFileSync(path.join(dir, 'Main.java'), main);
    const compile = spawnSync('javac', ['Solution.java', 'Main.java'], { cwd: dir, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: false });
    if (compile.status !== 0 || compile.error) {
      return { passed: 0, stderr: (compile.stderr || compile.error?.message || 'compile failed').slice(0, 500), compileFailed: true };
    }
    const res = spawnSync('java', ['Main'], { cwd: dir, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: false });
    return { passed: parseResult(res.stdout), stderr: res.stderr, error: res.error };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const RUNNERS = { python: runPython, javascript: runJavaScript, java: runJava };
const DEFAULT_TIMEOUTS = { python: 8000, javascript: 8000, java: 40000 };

export function scoreCodeExec(output, testCase) {
  const language = (testCase.metadata?.language || testCase.language || '').toLowerCase();
  const entry = testCase.expected?.entry;
  const cases = testCase.expected?.cases ?? [];
  const runner = RUNNERS[language];
  if (!runner) {
    return { score: 0, passed: false, reason: `code_exec: unsupported language "${language}" (have: ${Object.keys(RUNNERS).join(', ')})` };
  }
  if (!entry || cases.length === 0) {
    return { score: 0, passed: false, reason: 'code_exec: missing expected.entry or expected.cases' };
  }
  const code = extractCode(output);
  const timeoutMs = testCase.exec_timeout_ms || DEFAULT_TIMEOUTS[language] || 10000;
  const result = runner(code, entry, cases, timeoutMs);

  if (result.error && result.error.code === 'UNSUPPORTED_JAVA_TYPE') {
    return { score: 0, passed: false, reason: `code_exec: ${result.stderr}` };
  }
  if (result.compileFailed) {
    return { score: 0, passed: false, reason: `code_exec: ${language} did not compile` };
  }
  if (result.error) {
    const why = result.error.code === 'ETIMEDOUT' ? 'timed out' : result.error.message || 'run failed';
    return { score: 0, passed: false, reason: `code_exec: ${language} ${why}` };
  }
  if (result.passed == null) {
    return { score: 0, passed: false, reason: `code_exec: no result from ${language} runtime` };
  }
  const score = Math.round((result.passed / cases.length) * 100);
  return {
    score,
    passed: score === 100,
    reason: score === 100
      ? `all ${cases.length} ${language} cases passed`
      : `${result.passed}/${cases.length} ${language} cases passed`,
  };
}
