#!/usr/bin/env node
import {
  discoverModels,
  exportRoutingAdapter,
  formatModelsList,
  listAvailablePresets,
  parseArgs,
  runCompare,
  runLiveBenchmark,
  runProfile,
  runSampleBenchmark,
  summarizeResult,
  writePromptfooConfig,
  writeReportFromFile,
} from './cliCore.js';

function help() {
  return `RouteBench Phase 0

Commands:
  node src/cli.js presets
  node src/cli.js models [--output results/models.json] [--filter-provider oc]
  node src/cli.js sample [--output results/sample-results.json]
  node src/cli.js run [--benchmark benchmarks/basics.json] [--preset opencode-free] [--output results/out.json] [--report results/out.md] [--route-output results/routing.json] [--prefer quality|balanced|speed|cost]
  node src/cli.js report [--input results/model-results.json] [--output results/model-report.md]
  node src/cli.js profile [--input results/model-results.json] [--agentic results/agentic-results.json] [--output results/profiles.json] [--report results/profiles.md]
  node src/cli.js compare --baseline results/run1.json --candidate results/run2.json [--output results/compare.json] [--report results/compare.md]
  node src/cli.js routing-export --input results/routing.json --format litellm|generic --output results/litellm-config.yaml
  node src/cli.js promptfoo-config [--benchmark benchmarks/basics.json] [--output promptfooconfig.yaml]

Presets (use --preset to skip manual model list):
  opencode-free          4 active OpenCode Free models on 9router
  opencode-free-extended 4 active + 2 suggested OpenCode Free models
  opencode-free-code     3 code-focused OpenCode Free models

Benchmark packs:
  benchmarks/basics.json            30-case general router smoke test (default)
  benchmarks/claude-code-compat.json 25-case code generation + reasoning + injection
  benchmarks/frontier.json          39-case single-turn (algorithms, JS semantics, security, injection)
  benchmarks/code-assistant.json    30-case coding-assistant eval (repair, architecture, security, scheduler)
  benchmarks/polyglot-hard.json     18-case per-language exec (Python/Java/JS) + CWE/security detection

Agentic + profiling:
  npm run bench:agentic             multi-turn repo repair (measures iterative fix capability)
  node src/cli.js profile --input <results.json> [--agentic <agentic-results.json>]
                                    fused per-model Profile Cards (role + use/avoid)

Config file (routebench.config.json, auto-loaded):
  { "base_url": "...", "api_key": "...", "models": ["a","b"], "timeout_ms": 30000,
    "routing_preference": "quality",
    "model_costs": { "model-a": { "input_per_1k": 0.002, "output_per_1k": 0.004 } } }

Env (overrides config file):
  ROUTEBENCH_BASE_URL=https://9router.home/v1
  ROUTEBENCH_API_KEY=sk-9router
  ROUTEBENCH_MODELS=oc/deepseek-v4-flash-free,oc/north-mini-code-free
  ROUTEBENCH_TIMEOUT_MS=120000

Quick start — OpenCode Free on 9router:
  cp routebench.config.opencode.example.json routebench.config.json
  npm run bench:opencode
  npm run bench:opencode-code
`;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const benchmarkPath = flags.benchmark || 'benchmarks/basics.json';

  if (command === 'presets') {
    console.log(listAvailablePresets());
    return;
  }

  if (command === 'models') {
    const discovery = await discoverModels({ outputPath: flags.output, filterProvider: flags['filter-provider'] });
    console.log(formatModelsList(discovery));
    if (flags['filter-provider']) console.log(`(filtered by provider: ${flags['filter-provider']})`);
    if (flags.output) console.log(`\nSaved ${flags.output}`);
    return;
  }

  if (command === 'sample') {
    const outputPath = flags.output || 'results/sample-results.json';
    const reportPath = flags.report;
    const result = await runSampleBenchmark({ outputPath, reportPath });
    console.log(summarizeResult(result));
    console.log(`\nSaved ${outputPath}`);
    if (reportPath) console.log(`Saved ${reportPath}`);
    return;
  }

  if (command === 'run') {
    const outputPath = flags.output || 'results/model-results.json';
    const reportPath = flags.report;
    const routeOutputPath = flags['route-output'];
    const prefer = flags.prefer;
    const presetId = flags.preset;
    const result = await runLiveBenchmark({ benchmarkPath, outputPath, reportPath, routeOutputPath, prefer, presetId });
    console.log(summarizeResult(result));
    console.log(`\nSaved ${outputPath}`);
    if (reportPath) console.log(`Saved ${reportPath}`);
    if (routeOutputPath) console.log(`Saved ${routeOutputPath}`);
    return;
  }

  if (command === 'report') {
    const inputPath = flags.input || 'results/model-results.json';
    const outputPath = flags.output || 'results/model-report.md';
    await writeReportFromFile({ inputPath, outputPath });
    console.log(`Saved ${outputPath}`);
    return;
  }

  if (command === 'profile') {
    const inputPath = flags.input || 'results/model-results.json';
    const agenticPath = flags.agentic;
    const outputPath = flags.output || 'results/profiles.json';
    const reportPath = flags.report || 'results/profiles.md';
    const { profiles } = await runProfile({ inputPath, agenticPath, outputPath, reportPath });
    console.log('RouteBench Model Profiles');
    for (const p of profiles) {
      console.log(`  ${p.model}: ${p.role} (overall ${p.overall_score}, ${p.latency_class})`);
    }
    console.log(`\nSaved ${outputPath}`);
    console.log(`Saved ${reportPath}`);
    return;
  }

  if (command === 'compare') {
    const baselinePath = flags.baseline;
    const candidatePath = flags.candidate;
    if (!baselinePath || !candidatePath) {
      console.error('Usage: node src/cli.js compare --baseline <file> --candidate <file> [--output <file>] [--report <file>]');
      process.exitCode = 1;
      return;
    }
    const outputPath = flags.output;
    const reportPath = flags.report;
    const result = await runCompare({ baselinePath, candidatePath, outputPath, reportPath });
    const rc = result.recommendation_change;
    console.log('RouteBench Compare');
    console.log(`Baseline:  ${baselinePath}`);
    console.log(`Candidate: ${candidatePath}`);
    if (rc.primary_changed) {
      console.log(`Primary model CHANGED: ${rc.baseline_primary} → ${rc.candidate_primary}`);
    } else {
      console.log(`Primary model unchanged: ${rc.baseline_primary}`);
    }
    const s = result.summary;
    console.log(`${s.total_regressions} regression(s), ${s.total_improvements} improvement(s), ${s.new_failure_count} new failure(s), ${s.recovered_count} recovered`);
    if (outputPath) console.log(`\nSaved ${outputPath}`);
    if (reportPath) console.log(`Saved ${reportPath}`);
    return;
  }

  if (command === 'routing-export') {
    const inputPath = flags.input || 'results/routing.json';
    const format = flags.format || 'generic';
    const defaultOutput = format === 'litellm' ? 'results/litellm-config.yaml' : 'results/generic-config.json';
    const outputPath = flags.output || defaultOutput;
    await exportRoutingAdapter({ inputPath, format, outputPath });
    console.log(`Saved ${outputPath} (format: ${format})`);
    return;
  }

  if (command === 'promptfoo-config') {
    const outputPath = flags.output || 'promptfooconfig.yaml';
    await writePromptfooConfig({ benchmarkPath, outputPath });
    console.log(`Saved ${outputPath}`);
    return;
  }

  console.log(help());
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
