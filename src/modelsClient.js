function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function parseJsonText(text) {
  return JSON.parse(text.trim());
}

export function normalizeModelsResponse(json) {
  const models = Array.isArray(json.data)
    ? json.data
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({ id: item.id, owned_by: item.owned_by ?? item.owner ?? 'unknown' }))
    : [];
  return { object: json.object ?? 'list', models };
}

export function createModelsClient({ baseUrl, apiKey, timeoutMs, fetchImpl = fetch }) {
  return async function listModels() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(joinUrl(baseUrl, '/models'), {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`models endpoint returned ${response.status}: ${body.slice(0, 500)}`);
      }
      return normalizeModelsResponse(parseJsonText(body));
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`models endpoint timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
