import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFileEdits, runAgenticTask } from '../src/agentic.js';

test('parseFileEdits extracts a single tagged file block', () => {
  const out = '```js\n// FILE: src/a.js\nexport const x = 1;\n```';
  const edits = parseFileEdits(out);
  assert.deepEqual(Object.keys(edits), ['src/a.js']);
  assert.match(edits['src/a.js'], /export const x = 1;/);
});

test('parseFileEdits extracts multiple file blocks', () => {
  const out = [
    '```js',
    '// FILE: src/a.js',
    'export const a = 1;',
    '```',
    'some prose',
    '```js',
    '// FILE: src/b.js',
    'export const b = 2;',
    '```',
  ].join('\n');
  const edits = parseFileEdits(out);
  assert.deepEqual(Object.keys(edits).sort(), ['src/a.js', 'src/b.js']);
});

test('parseFileEdits ignores blocks without a FILE header', () => {
  const out = '```js\nconsole.log("no header");\n```';
  assert.deepEqual(parseFileEdits(out), {});
});

test('parseFileEdits rejects path traversal and absolute paths', () => {
  const out = [
    '```\n// FILE: ../escape.js\nbad\n```',
    '```\n// FILE: /etc/passwd\nbad\n```',
    '```\n// FILE: a/../../b.js\nbad\n```',
  ].join('\n');
  assert.deepEqual(parseFileEdits(out), {});
});

test('parseFileEdits normalizes a leading ./ in the path', () => {
  const out = '```\n// FILE: ./src/c.js\nexport const c = 3;\n```';
  const edits = parseFileEdits(out);
  assert.deepEqual(Object.keys(edits), ['src/c.js']);
});

// --- Integration: real node --test in a temp dir, stubbed model -------------

const PKG = JSON.stringify({ type: 'module', name: 't', private: true });

function fixture() {
  return {
    id: 'answer_fix',
    name: 'fix answer',
    test_cmd: ['node', '--test'],
    protected_paths: ['test/'],
    files: {
      'package.json': PKG,
      'src/answer.js': 'export function answer() { return 1; }\n',
      'test/answer.test.js': [
        "import test from 'node:test';",
        "import assert from 'node:assert';",
        "import { answer } from '../src/answer.js';",
        "test('answer is 42', () => assert.strictEqual(answer(), 42));",
        '',
      ].join('\n'),
    },
  };
}

function reply(body) {
  return { output: body, usage: { completion_tokens: 10, prompt_tokens: 20, total_tokens: 30 } };
}

test('runAgenticTask solves in one turn and scores 100', async () => {
  const callChat = async () => reply('```js\n// FILE: src/answer.js\nexport function answer() { return 42; }\n```');
  const row = await runAgenticTask({ task: fixture(), model: 'stub', callChat, maxTurns: 3 });
  assert.equal(row.passed, true);
  assert.equal(row.turns_used, 1);
  assert.equal(row.score, 100);
  assert.deepEqual(row.history[0].applied_files, ['src/answer.js']);
});

test('runAgenticTask iterates: wrong fix then correct, scores by turns', async () => {
  let turn = 0;
  const callChat = async () => {
    turn += 1;
    const value = turn === 1 ? 7 : 42;
    return reply(`\`\`\`js\n// FILE: src/answer.js\nexport function answer() { return ${value}; }\n\`\`\``);
  };
  const row = await runAgenticTask({ task: fixture(), model: 'stub', callChat, maxTurns: 3 });
  assert.equal(row.passed, true);
  assert.equal(row.turns_used, 2);
  assert.equal(row.score, 90); // 100 - (2-1)*10
});

test('runAgenticTask ignores edits to protected test files', async () => {
  // Model tries to neuter the test instead of fixing the source.
  const callChat = async () => reply(
    "```js\n// FILE: test/answer.test.js\nimport test from 'node:test';\ntest('noop', () => {});\n```",
  );
  const row = await runAgenticTask({ task: fixture(), model: 'stub', callChat, maxTurns: 1 });
  assert.equal(row.passed, false);
  // The protected test edit was filtered out — nothing applied.
  assert.deepEqual(row.history[0].applied_files, []);
});

test('runAgenticTask records a provider error without throwing', async () => {
  const callChat = async () => {
    const err = new Error('boom');
    err.type = 'provider_http_error';
    throw err;
  };
  const row = await runAgenticTask({ task: fixture(), model: 'stub', callChat, maxTurns: 2 });
  assert.equal(row.status, 'provider_error');
  assert.equal(row.passed, false);
  assert.match(row.error_message, /boom/);
});
