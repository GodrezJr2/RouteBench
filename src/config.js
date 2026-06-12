export function loadConfigFromEnv(env = process.env) {
  return {
    baseUrl: env.ROUTEBENCH_BASE_URL || env.OPENAI_BASE_URL || '',
    apiKey: env.ROUTEBENCH_API_KEY || env.OPENAI_API_KEY || '',
    models: String(env.ROUTEBENCH_MODELS || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    timeoutMs: Number(env.ROUTEBENCH_TIMEOUT_MS || 0),
    concurrency: Number(env.ROUTEBENCH_CONCURRENCY || 0),
    modelCosts: null,
  };
}

export function loadConfigFromFile(json) {
  return {
    baseUrl: json.base_url ?? '',
    apiKey: json.api_key ?? '',
    models: Array.isArray(json.models) ? json.models.map((m) => String(m).trim()).filter(Boolean) : [],
    timeoutMs: Number(json.timeout_ms || 0),
    concurrency: Number(json.concurrency || 0),
    modelCosts: json.model_costs ?? {},
    routingPreference: typeof json.routing_preference === 'string' ? json.routing_preference : '',
  };
}

export function mergeConfigs(fileConf, envConf) {
  const envConcurrency = Number(envConf.concurrency || 0);
  const fileConcurrency = Number(fileConf.concurrency || 0);
  return {
    baseUrl: envConf.baseUrl || fileConf.baseUrl,
    apiKey: envConf.apiKey || fileConf.apiKey,
    models: envConf.models.length > 0 ? envConf.models : fileConf.models,
    timeoutMs: envConf.timeoutMs > 0 ? envConf.timeoutMs : fileConf.timeoutMs > 0 ? fileConf.timeoutMs : 30000,
    concurrency: envConcurrency > 0 ? envConcurrency : fileConcurrency > 0 ? fileConcurrency : 4,
    modelCosts: envConf.modelCosts ?? fileConf.modelCosts ?? {},
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
