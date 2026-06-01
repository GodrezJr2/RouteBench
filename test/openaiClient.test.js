import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAICompatibleClient } from '../src/openaiClient.js';

test('calls OpenAI-compatible chat completions endpoint', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return '{"choices":[{"message":{"content":"391"}}],"usage":{"total_tokens":5}}';
      },
    };
  };

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1/',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  const response = await client({
    model: 'demo-model',
    testCase: { system: 'Answer only.', prompt: '17 * 23' },
  });

  assert.equal(response.output, '391');
  assert.deepEqual(response.usage, { total_tokens: 5 });
  assert.equal(requests[0].url, 'https://router.example.com/v1/chat/completions');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer sk-test');
  assert.match(requests[0].options.body, /demo-model/);
});

test('parses JSON response with trailing SSE done marker from 9router', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return '{"choices":[{"message":{"content":"OK"}}],"usage":{"total_tokens":2}}\ndata: [DONE]\n';
    },
  });

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  const response = await client({ model: 'demo-model', testCase: { system: 'x', prompt: 'y' } });

  assert.equal(response.output, 'OK');
  assert.deepEqual(response.usage, { total_tokens: 2 });
});

test('provider HTTP errors include type status and body preview', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 422,
    async text() {
      return '{"error":{"message":"bad model"}}';
    },
  });

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  await assert.rejects(
    () => client({ model: 'bad-model', testCase: { id: 'case_001', system: 'x', prompt: 'y' } }),
    (error) => {
      assert.equal(error.type, 'provider_http_error');
      assert.equal(error.status, 422);
      assert.match(error.body_preview, /bad model/);
      return true;
    },
  );
});

test('throws useful error for provider failures', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    async text() {
      return 'rate limited';
    },
  });

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  await assert.rejects(
    () => client({ model: 'demo-model', testCase: { system: 'x', prompt: 'y' } }),
    /provider returned 429: rate limited/,
  );
});
