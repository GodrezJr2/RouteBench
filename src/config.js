export function loadConfigFromEnv(env = process.env) {
  return {
    baseUrl: env.ROUTEBENCH_BASE_URL || env.OPENAI_BASE_URL || '',
    apiKey: env.ROUTEBENCH_API_KEY || env.OPENAI_API_KEY || '',
    models: String(env.ROUTEBENCH_MODELS || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    timeoutMs: Number(env.ROUTEBENCH_TIMEOUT_MS || 30000),
  };
}

export function validateConfig(config) {
  if (!config.baseUrl) throw new Error('ROUTEBENCH_BASE_URL or OPENAI_BASE_URL is required');
  if (!config.apiKey) throw new Error('ROUTEBENCH_API_KEY or OPENAI_API_KEY is required');
  if (!Array.isArray(config.models) || config.models.length < 2) {
    throw new Error('ROUTEBENCH_MODELS must include at least two models');
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('ROUTEBENCH_TIMEOUT_MS must be a positive number');
  }
  return config;
}
