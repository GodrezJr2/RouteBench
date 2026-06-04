#!/usr/bin/env node
import {
  discoverModels,
  exportRoutingAdapter,
  formatModelsList,
  parseArgs,
  runCompare,
  runLiveBenchmark,
  runSampleBenchmark,
  summarizeResult,
  writePromptfooConfig,
  writeReportFromFile,
} from './cliCore.js';

function help() {
  return `RouteBench Phase 0

Commands:
  node src/cli.js models [--output results/models.json]
  node src/cli.js sample [--output results/sample-results.json]
  node src/cli.js run [--benchmark benchmarks/phase0.json] [--output results/model-results.json] [--report results/model-report.md] [--route-output results/routing.json] [--prefer quality|balanced|speed|cost]
  node src/cli.js report [--input results/model-results.json] [--output results/model-report.md]
  node src/cli.js compare --baseline results/run1.json --candidate results/run2.json [--output results/compare.json] [--report results/compare.md]
  node src/cli.js routing-export --input results/routing.json --format litellm|generic --output results/litellm-config.yaml
  node src/cli.js promptfoo-config [--benchmark benchmarks/phase0.json] [--output promptfooconfig.yaml]

Config file (auto-loaded from routebench.config.json if present):
  { "base_url": "...", "api_key": "...", "models": ["a","b"], "timeout_ms": 30000,
    "model_costs": { "model-a": { "input_per_1k": 0.002, "output_per_1k": 0.004 } } }

Live benchmark env (overrides config file):
  ROUTEBENCH_BASE_URL=https://router.example.com/v1
  ROUTEBENCH_API_KEY=sk-...
  ROUTEBENCH_MODELS=model-a,model-b
  ROUTEBENCH_TIMEOUT_MS=30000

Promptfoo:
  npm install
  npm run promptfoo:config
  npx promptfoo@latest eval -c promptfooconfig.yaml --output results/promptfoo-results.json
`;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const benchmarkPath = flags.benchmark || 'benchmarks/phase0.json';

  if (command === 'models') {
    const discovery = await discoverModels({ outputPath: flags.output });
    console.log(formatModelsList(discovery));
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
    const result = await runLiveBenchmark({ benchmarkPath, outputPath, reportPath, routeOutputPath, prefer });
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
