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

async function parseProviderJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (firstError) {
    try {
      return JSON.parse(extractFirstJsonObject(body));
    } catch {
      throw providerError(`provider returned malformed JSON: ${firstError.message}`, {
        type: 'malformed_provider_json',
        body_preview: body.slice(0, 500),
      });
    }
  }
}

export function createOpenAICompatibleClient({ baseUrl, apiKey, timeoutMs, fetchImpl = fetch }) {
  return async function callOpenAICompatible({ model, testCase }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(joinUrl(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: testCase.system },
            { role: 'user', content: testCase.prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw providerError(`provider returned ${response.status}: ${body.slice(0, 500)}`, {
          type: 'provider_http_error',
          status: response.status,
          body_preview: body.slice(0, 500),
        });
      }

      const json = await parseProviderJson(response);
      return {
        output: json.choices?.[0]?.message?.content ?? '',
        usage: json.usage ?? null,
      };
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
  };
}
