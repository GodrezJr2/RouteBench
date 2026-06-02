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

test('retries without temperature when provider rejects the parameter', async () => {
  const bodies = [];
  let call = 0;
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    call += 1;
    if (call === 1) {
      return {
        ok: false,
        status: 400,
        async text() {
          return '{"error":{"message":"Unsupported parameter: \'temperature\' is not supported with this model."}}';
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return '{"choices":[{"message":{"content":"42"}}],"usage":{"total_tokens":3}}';
      },
    };
  };

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  const response = await client({ model: 'mystery-model-v2', testCase: { system: 'x', prompt: 'y' } });

  assert.equal(response.output, '42');
  assert.equal(call, 2);
  assert.equal(bodies[0].temperature, 0); // first attempt includes it
  assert.equal('temperature' in bodies[1], false); // retry omits it
});

test('skips temperature preemptively for reasoning/GPT-5+ models', async () => {
  const bodies = [];
  let call = 0;
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    call += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return '{"choices":[{"message":{"content":"391"}}],"usage":{"total_tokens":3}}';
      },
    };
  };

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  for (const model of ['gh/gpt-5.4-mini', 'gh/gpt-5.2-codex', 'o3-mini', 'openrouter/x/glm-reasoning']) {
    bodies.length = 0; call = 0;
    const r = await client({ model, testCase: { system: 'x', prompt: 'y' } });
    assert.equal(r.output, '391');
    assert.equal(call, 1, `${model} should not retry`);
    assert.equal('temperature' in bodies[0], false, `${model} should omit temperature`);
  }
});

test('still sends temperature for standard models', async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = JSON.parse(options.body);
    return { ok: true, status: 200, async text() { return '{"choices":[{"message":{"content":"ok"}}]}'; } };
  };
  const client = createOpenAICompatibleClient({ baseUrl: 'https://r/v1', apiKey: 'k', timeoutMs: 5000, fetchImpl });
  await client({ model: 'gh/gpt-4o-mini', testCase: { system: 'x', prompt: 'y' } });
  assert.equal(captured.temperature, 0);
});

test('parses streamed SSE chat completion (delta chunks)', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"3"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"91"}}]}',
    '',
    'data: {"choices":[{"delta":{}}],"usage":{"total_tokens":7}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  const fetchImpl = async () => ({ ok: true, status: 200, async text() { return sse; } });
  const client = createOpenAICompatibleClient({ baseUrl: 'https://r/v1', apiKey: 'k', timeoutMs: 5000, fetchImpl });

  const r = await client({ model: 'gh/gpt-5.4-mini', testCase: { system: 'x', prompt: 'y' } });
  assert.equal(r.output, '391');
  assert.deepEqual(r.usage, { total_tokens: 7 });
});

test('400 errors unrelated to temperature are not retried', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    return {
      ok: false,
      status: 400,
      async text() {
        return '{"error":{"message":"invalid model id"}}';
      },
    };
  };

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 5000,
    fetchImpl,
  });

  await assert.rejects(
    () => client({ model: 'bad', testCase: { system: 'x', prompt: 'y' } }),
    (error) => {
      assert.equal(error.type, 'provider_http_error');
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(call, 1); // no retry
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
