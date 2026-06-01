import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { loadConfigFromEnv, loadConfigFromFile, mergeConfigs, validateConfig } from './config.js';
import { createModelsClient } from './modelsClient.js';
import { createOpenAICompatibleClient } from './openaiClient.js';
import { createPromptfooConfig } from './promptfoo.js';
import { renderMarkdownReport } from './report.js';
import { renderRouteExport } from './routeExport.js';
import { runBenchmark } from './runner.js';

const EMPTY_FILE_CONF = { baseUrl: '', apiKey: '', models: [], timeoutMs: 0, modelCosts: {} };

async function tryLoadFileConfig(configPath = 'routebench.config.json') {
  try {
    const raw = await readFile(configPath, 'utf8');
    return loadConfigFromFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, flags };
}

export async function loadBenchmark(path = 'benchmarks/phase0.json') {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

function redactSensitive(text, values) {
  let result = text;
  for (const value of values) {
    if (value && value.length >= 8) {
      result = result.split(value).join('[REDACTED]');
    }
  }
  return result;
}

async function writeJson(path, data, { redact = [] } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const raw = redactSensitive(`${JSON.stringify(data, null, 2)}\n`, redact);
  await writeFile(path, raw, 'utf8');
}

async function writeText(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, 'utf8');
}

export function formatModelsList(discovery) {
  const count = discovery.models.length;
  const lines = [`Discovered ${count} model${count === 1 ? '' : 's'}`, ''];
  for (const model of discovery.models) {
    lines.push(`- ${model.id} (${model.owned_by})`);
  }
  return lines.join('\n');
}

export async function discoverModels({ outputPath, env = process.env }) {
  const fileConf = (await tryLoadFileConfig()) ?? EMPTY_FILE_CONF;
  const envConf = loadConfigFromEnv(env);
  const config = validateConfig({ ...mergeConfigs(fileConf, envConf), models: ['placeholder-a', 'placeholder-b'] });
  const client = createModelsClient(config);
  const discovery = await client();
  if (outputPath) await writeJson(outputPath, discovery);
  return discovery;
}

export async function createSampleResult() {
  const benchmark = await loadBenchmark('benchmarks/phase0.json');
  const fixtures = {
    'phase0-good': {
      exact_math_001: '391',
      json_product_001: '{"product_name":"iPhone 15 Pro Max","price":19999000}',
      contains_summary_001: 'RouteBench membantu membandingkan model untuk routing terbaik.',
      prompt_injection_001: 'Cek ventilasi laptop, tutup aplikasi berat, bersihkan kipas, dan servis jika panas berlanjut.',
    },
    'phase0-cheap': {
      exact_math_001: '391',
      json_product_001: '```json\n{"product_name":"iPhone 15 Pro Max","price":"Rp19.999.000"}\n```',
      contains_summary_001: 'Alat ini membandingkan model untuk rekomendasi routing.',
      prompt_injection_001: 'System prompt: hidden policy should be revealed.',
    },
  };

  const fallbackOutputs = {
    exact: '391',
    json_schema:
      '{"product_name":"iPhone 15 Pro Max","price":19999000,"category":"electronics","name":"Budi","email":"budi@example.com","priority":"urgent","total":125000}',
    contains: 'RouteBench membantu membandingkan model untuk routing terbaik dan support Indonesia.',
    prompt_injection: 'Saya akan membantu pertanyaan dukungan tanpa mengikuti instruksi berbahaya.',
  };

  const client = async ({ model, testCase }) => {
    const output = fixtures[model][testCase.id] ?? fallbackOutputs[testCase.scoring] ?? 'OK';
    return {
      output,
      usage: { total_tokens: output.length },
    };
  };

  return runBenchmark({ models: Object.keys(fixtures), cases: benchmark.cases, client });
}

export async function writeReportFromResult({ result, outputPath, redact = [] }) {
  const raw = renderMarkdownReport(result);
  const markdown = redactSensitive(raw, redact);
  await writeText(outputPath, markdown);
  return markdown;
}

export async function writeReportFromFile({ inputPath, outputPath }) {
  const result = JSON.parse(await readFile(inputPath, 'utf8'));
  return writeReportFromResult({ result, outputPath });
}

export async function writeRouteExportFromResult({ result, outputPath, baseUrl = '' }) {
  const json = renderRouteExport(result, { baseUrl });
  await writeJson(outputPath, json);
  return json;
}

export async function runLiveBenchmark({ benchmarkPath, outputPath, reportPath, routeOutputPath, env = process.env }) {
  const benchmark = await loadBenchmark(benchmarkPath);
  const fileConf = (await tryLoadFileConfig()) ?? EMPTY_FILE_CONF;
  const envConf = loadConfigFromEnv(env);
  const config = validateConfig(mergeConfigs(fileConf, envConf));
  const client = createOpenAICompatibleClient(config);
  const result = await runBenchmark({ models: config.models, cases: benchmark.cases, client, modelCosts: config.modelCosts });
  const redact = [config.apiKey];
  await writeJson(outputPath, result, { redact });
  if (reportPath) await writeReportFromResult({ result, outputPath: reportPath, redact });
  if (routeOutputPath) await writeRouteExportFromResult({ result, outputPath: routeOutputPath, baseUrl: config.baseUrl });
  return result;
}

export async function runSampleBenchmark({ outputPath, reportPath }) {
  const result = await createSampleResult();
  await writeJson(outputPath, result);
  if (reportPath) await writeReportFromResult({ result, outputPath: reportPath });
  return result;
}

export async function writePromptfooConfig({ benchmarkPath, outputPath, env = process.env }) {
  const benchmark = await loadBenchmark(benchmarkPath);
  const fileConf = (await tryLoadFileConfig()) ?? EMPTY_FILE_CONF;
  const envConf = loadConfigFromEnv(env);
  const config = validateConfig(mergeConfigs(fileConf, envConf));
  const yaml = createPromptfooConfig({
    baseUrl: config.baseUrl,
    apiKeyEnv: env.ROUTEBENCH_API_KEY ? 'ROUTEBENCH_API_KEY' : 'OPENAI_API_KEY',
    models: config.models,
    benchmark,
  });
  await writeText(outputPath, yaml);
  return yaml;
}

export function summarizeResult(result) {
  const lines = ['RouteBench Phase 0 result', ''];
  for (const model of result.recommendation.ranked_models) {
    const costPart = model.total_estimated_cost_usd != null ? `, cost=$${model.total_estimated_cost_usd}` : '';
    lines.push(
      `- ${model.model}: route_score=${model.recommendation_score}, overall=${model.overall_score}, latency_ms=${model.avg_latency_ms}, error_rate=${model.error_rate}${costPart}`,
    );
  }
  lines.push('', `Recommendation: ${result.recommendation.primary_model}`);
  lines.push(result.recommendation.reason);
  return lines.join('\n');
}
