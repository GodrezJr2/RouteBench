function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function providerError(message, fields = {}) {
  const error = new Error(message);
  Object.assign(error, fields);
  return error;
}

function extractFirstJsonObject(text) {
  const trimmed = text.trimStart();
  const start = trimmed.indexOf('{');
  if (start === -1) throw new Error('provider response did not contain a JSON object');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }

  throw new Error('provider response contained incomplete JSON');
}

// Reasoning / GPT-5+ models reject the temperature parameter. Skip it
// preemptively so we never trigger the provider's error (and any error-cooldown
// on routers like 9router that cache the failure for several seconds).
function modelRejectsTemperature(model) {
  return /gpt-[5-9]|gpt-oss|\bo[1-9]\b|codex|reasoning/i.test(String(model));
}

// Parse an SSE event stream (`data: {chunk}\n\n … data: [DONE]`) into chunk objects.
function parseSseChunks(text) {
  const chunks = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      chunks.push(JSON.parse(payload));
    } catch {
      // skip keep-alive / non-JSON lines
    }
  }
  return chunks;
}

// Normalize either a standard chat-completion JSON body or a streamed SSE body
// into { output, usage }. Handles 9router's trailing `data: [DONE]` marker.
function parseChatCompletion(text) {
  if (text.trimStart().startsWith('data:')) {
    const chunks = parseSseChunks(text);
    if (chunks.length === 0) {
      throw providerError('provider returned an empty SSE stream', {
        type: 'malformed_provider_json',
        body_preview: text.slice(0, 500),
      });
    }
    let output = '';
    let usage = null;
    for (const chunk of chunks) {
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) output += choice.delta.content;
      else if (choice?.message?.content) output += choice.message.content;
      if (chunk.usage) usage = chunk.usage;
    }
    return { output, usage };
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (firstError) {
    try {
      json = JSON.parse(extractFirstJsonObject(text));
    } catch {
      throw providerError(`provider returned malformed JSON: ${firstError.message}`, {
        type: 'malformed_provider_json',
        body_preview: text.slice(0, 500),
      });
    }
  }
  return {
    output: json.choices?.[0]?.message?.content ?? '',
    usage: json.usage ?? null,
  };
}

// Transient failures worth retrying — rate limits, gateway/server hiccups, and
// network/timeout blips. Permanent 4xx (400/401/403/404/422) are NOT retried.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_TYPES = new Set(['timeout', 'network_error']);

function isTransient(error) {
  if (TRANSIENT_TYPES.has(error.type)) return true;
  return error.type === 'provider_http_error' && TRANSIENT_STATUSES.has(error.status);
}

function backoffMs(attempt, baseMs, retryAfterMs) {
  if (retryAfterMs != null) return retryAfterMs;
  const exp = baseMs * 2 ** (attempt - 1);
  return exp + Math.floor(Math.random() * baseMs); // full jitter on the base
}

// Shared low-level caller: one HTTP attempt + retry wrapper around a raw
// `messages` array. Both the single-turn benchmark client and the multi-turn
// agentic client build on this so retry/temperature/parse logic stays in one
// place.
function buildMessagesCaller({
  baseUrl,
  apiKey,
  timeoutMs,
  fetchImpl = fetch,
  maxRetries = 2,
  retryBaseMs = 500,
  sleepImpl,
}) {
  const sleep = sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  // One HTTP attempt: returns { output, usage } or throws a classified error.
  async function attemptOnce({ model, messages }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const sendRequest = (includeTemperature) => {
      const payload = { model, messages };
      if (includeTemperature) payload.temperature = 0;
      return fetchImpl(joinUrl(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    };

    try {
      const skipTemperature = modelRejectsTemperature(model);
      let response = await sendRequest(!skipTemperature);

      // Fallback for models we didn't preemptively flag: if the provider
      // rejects temperature, retry once without it. (On routers that cache the
      // error this may still fail, which is why we also skip preemptively.)
      if (response.status === 400 && !skipTemperature) {
        const body = await response.text();
        if (/temperature/i.test(body) && /unsupported|not supported/i.test(body)) {
          response = await sendRequest(false);
        } else {
          throw providerError(`provider returned ${response.status}: ${body.slice(0, 500)}`, {
            type: 'provider_http_error',
            status: response.status,
            body_preview: body.slice(0, 500),
          });
        }
      }

      if (!response.ok) {
        const body = await response.text();
        const rawRetryAfter = response.headers?.get?.('retry-after');
        const retryAfterMs = rawRetryAfter && /^\d+$/.test(String(rawRetryAfter).trim())
          ? Number(String(rawRetryAfter).trim()) * 1000
          : null;
        throw providerError(`provider returned ${response.status}: ${body.slice(0, 500)}`, {
          type: 'provider_http_error',
          status: response.status,
          body_preview: body.slice(0, 500),
          retry_after_ms: retryAfterMs,
        });
      }

      const body = await response.text();
      return parseChatCompletion(body);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw providerError(`provider request timed out after ${timeoutMs}ms`, { type: 'timeout' });
      }
      if (!error.type && error instanceof TypeError) {
        throw providerError(`network error: ${error.message}`, { type: 'network_error' });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return async function callWithRetry({ model, messages }) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        return await attemptOnce({ model, messages });
      } catch (error) {
        lastError = error;
        if (!isTransient(error) || attempt > maxRetries) throw error;
        await sleep(backoffMs(attempt, retryBaseMs, error.retry_after_ms));
      }
    }
    throw lastError;
  };
}

export function createOpenAICompatibleClient(config) {
  const call = buildMessagesCaller(config);
  return function callOpenAICompatible({ model, testCase }) {
    const messages = [
      { role: 'system', content: testCase.system },
      { role: 'user', content: testCase.prompt },
    ];
    return call({ model, messages });
  };
}

// Multi-turn client for the agentic harness: takes a raw `messages` array
// (full conversation history) instead of a single test case. Same retry,
// temperature, and SSE/JSON parsing behavior as the single-turn client.
export function createChatClient(config) {
  const call = buildMessagesCaller(config);
  return function callChat({ model, messages }) {
    return call({ model, messages });
  };
}
