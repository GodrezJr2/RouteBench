import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// RouteBench agentic harness (v0).
//
// Measures what the single-turn benchmark cannot: can a model iteratively fix a
// broken multi-file repo using test feedback? Each task is a small repo with a
// failing test suite. The model gets the source + failing test output, replies
// with corrected files, we apply them, re-run the tests, and feed the result
// back — up to maxTurns. Score = did the suite go green, and in how many turns.
//
// SECURITY: model-authored code runs via `node --test` in a throwaway temp dir
// with a hard timeout. spawnSync is called with an ARGUMENT ARRAY and no shell
// (shell: false default), so there is no command-injection surface. This is a
// local benchmark against trusted router endpoints — the same trust level as
// the existing code_unit_test vm scorer. Do not point this at untrusted models
// on a machine with secrets.

const FILE_HEADER = /^\s*\/\/\s*FILE:\s*(.+?)\s*$/;

// Pull every fenced block whose first line is `// FILE: <path>` and map
// path -> file body. Models that wrap the whole reply in one block, or emit one
// block per file, both parse. Paths are normalized and constrained to the repo.
export function parseFileEdits(output) {
  const edits = {};
  const fenceRe = /```(?:[a-zA-Z0-9]+)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(output)) !== null) {
    const block = match[1];
    const lines = block.split('\n');
    const header = lines[0].match(FILE_HEADER);
    if (!header) continue;
    // Strip a leading `./` only — NOT a leading `/`, which must survive so the
    // absolute-path check below can reject it (e.g. `/etc/passwd`).
    const rel = header[1].replace(/\\/g, '/').replace(/^\.\//, '');
    // Reject path traversal / absolute paths — keep writes inside the repo.
    if (rel.startsWith('..') || rel.startsWith('/') || path.isAbsolute(rel) || rel.includes('../')) continue;
    edits[rel] = lines.slice(1).join('\n').replace(/\n+$/, '\n');
  }
  return edits;
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

// Run the task's test command in `dir`, capture combined output + pass/fail.
// spawnSync with an args array runs the binary directly (no shell interpolation).
function runTests(dir, testCmd, timeoutMs) {
  const [cmd, ...args] = testCmd;
  // Strip the parent process's test-runner context from the child env. When the
  // harness itself runs under `node --test`, Node leaks NODE_TEST_CONTEXT (and
  // related options) to spawned children, which makes a nested `node --test`
  // report over IPC instead of via exit code — yielding false passes. Removing
  // these makes the child a clean, standalone test process.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const res = spawnSync(cmd, args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    shell: false,
    env,
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const combined = `${stdout}\n${stderr}`.trim();
  // node --test exits 0 only when every test passes.
  const passed = res.status === 0 && !res.error;
  return {
    passed,
    exit_code: res.status,
    timed_out: res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM',
    output: combined.slice(0, 4000),
  };
}

const SYSTEM_PROMPT = [
  'You are a senior engineer fixing a broken code repository.',
  'You will be given the source files and the failing test output.',
  'The tests define the correct behavior — make them all pass.',
  '',
  'Reply with ONLY the complete corrected contents of each file you change.',
  'Format each file as a fenced code block whose FIRST line is a path comment:',
  '',
  '```js',
  '// FILE: src/example.js',
  '<full file contents here>',
  '```',
  '',
  'Rules:',
  '- Output the ENTIRE file, not a diff or snippet.',
  '- Only include files you are changing.',
  '- Do not change the test files.',
  '- No explanation outside the code blocks.',
].join('\n');

function firstUserMessage(files, testOutput) {
  const fileBlocks = Object.entries(files)
    .map(([rel, content]) => `// FILE: ${rel}\n${content}`)
    .join('\n\n');
  return [
    'Here is the repository:',
    '',
    fileBlocks,
    '',
    'Running the test suite produces this failing output:',
    '',
    '```',
    testOutput,
    '```',
    '',
    'Fix the source so all tests pass. Reply with the corrected file(s).',
  ].join('\n');
}

function sumUsage(a, b) {
  if (!b) return a;
  return {
    prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
    completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
  };
}

// Run one (model, task) agentic episode. Returns a structured result row.
export async function runAgenticTask({
  task,
  model,
  callChat,
  maxTurns = 5,
  testTimeoutMs = 20000,
  now = () => Date.now(),
  mkdtemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'routebench-agentic-')),
}) {
  const dir = mkdtemp();
  const start = now();
  const history = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let messages = null;
  let lastTest = null;

  try {
    writeFiles(dir, task.files);
    // Baseline: confirm the suite actually fails before the model touches it.
    const baseline = runTests(dir, task.test_cmd, testTimeoutMs);
    lastTest = baseline;

    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: firstUserMessage(task.files, baseline.output) },
    ];

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      let resp;
      try {
        resp = await callChat({ model, messages });
      } catch (error) {
        history.push({ turn, error: error.message, error_type: error.type ?? 'unknown_error' });
        return {
          model,
          task_id: task.id,
          task_name: task.name,
          status: 'provider_error',
          passed: false,
          turns_used: turn - 1,
          max_turns: maxTurns,
          score: 0,
          latency_ms: Math.max(0, now() - start),
          usage,
          error_message: `model ${model} failed on turn ${turn}: ${error.message}`,
          history,
        };
      }
      usage = sumUsage(usage, resp.usage);

      const edits = parseFileEdits(resp.output);
      const editedPaths = Object.keys(edits);
      // Ignore attempts to overwrite test files — tests are the fixed spec.
      const allowed = {};
      for (const [rel, content] of Object.entries(edits)) {
        if (task.protected_paths?.some((p) => rel === p || rel.startsWith(p))) continue;
        allowed[rel] = content;
      }
      if (Object.keys(allowed).length > 0) writeFiles(dir, allowed);

      const testResult = runTests(dir, task.test_cmd, testTimeoutMs);
      lastTest = testResult;
      history.push({
        turn,
        edited_files: editedPaths,
        applied_files: Object.keys(allowed),
        no_edits: editedPaths.length === 0,
        test_passed: testResult.passed,
        test_output: testResult.output,
        output_preview: resp.output.slice(0, 600),
      });

      if (testResult.passed) {
        return {
          model,
          task_id: task.id,
          task_name: task.name,
          status: 'completed',
          passed: true,
          turns_used: turn,
          max_turns: maxTurns,
          // Full credit for solving; small penalty per extra turn (min 60).
          score: Math.max(60, 100 - (turn - 1) * 10),
          latency_ms: Math.max(0, now() - start),
          usage,
          history,
        };
      }

      messages.push({ role: 'assistant', content: resp.output });
      messages.push({
        role: 'user',
        content: editedPaths.length === 0
          ? 'You did not provide any file edits in the required `// FILE:` format. Reply with the complete corrected file(s) using the format from the instructions.'
          : `Tests still failing:\n\n\`\`\`\n${testResult.output}\n\`\`\`\n\nFix the remaining failures. Reply with the corrected file(s).`,
      });
    }

    return {
      model,
      task_id: task.id,
      task_name: task.name,
      status: 'completed',
      passed: false,
      turns_used: maxTurns,
      max_turns: maxTurns,
      score: 0,
      latency_ms: Math.max(0, now() - start),
      usage,
      error_message: `did not pass within ${maxTurns} turns`,
      last_test_output: lastTest?.output ?? null,
      history,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

export async function runAgenticBenchmark({ tasks, models, callChat, maxTurns = 5, onProgress }) {
  const rows = [];
  let done = 0;
  const total = tasks.length * models.length;
  for (const model of models) {
    for (const task of tasks) {
      const row = await runAgenticTask({ task, model, callChat, maxTurns });
      rows.push(row);
      done += 1;
      if (onProgress) onProgress(done, total, row);
    }
  }
  return rows;
}
