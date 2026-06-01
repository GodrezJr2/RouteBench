#!/usr/bin/env node
import {
  discoverModels,
  formatModelsList,
  parseArgs,
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
  node src/cli.js run [--benchmark benchmarks/phase0.json] [--output results/model-results.json] [--report results/model-report.md]
  node src/cli.js report [--input results/model-results.json] [--output results/model-report.md]
  node src/cli.js promptfoo-config [--benchmark benchmarks/phase0.json] [--output promptfooconfig.yaml]

Live benchmark env:
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
    const result = await runLiveBenchmark({ benchmarkPath, outputPath, reportPath });
    console.log(summarizeResult(result));
    console.log(`\nSaved ${outputPath}`);
    if (reportPath) console.log(`Saved ${reportPath}`);
    return;
  }

  if (command === 'report') {
    const inputPath = flags.input || 'results/model-results.json';
    const outputPath = flags.output || 'results/model-report.md';
    await writeReportFromFile({ inputPath, outputPath });
    console.log(`Saved ${outputPath}`);
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
