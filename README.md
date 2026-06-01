# RouteBench Phase 0.5

Local-first CLI proof-of-concept for comparing models behind an OpenAI-compatible endpoint such as 9router.

Phase 0.5 intentionally does **not** include auth, database, SaaS, queue workers, dashboards, or LLM-as-judge scoring.

## What it does

- Discovers models from `/v1/models`.
- Runs a 30-case deterministic benchmark pack from `benchmarks/phase0.json`.
- Calls `/chat/completions` on an OpenAI-compatible endpoint.
- Scores exact match, JSON field compliance, contains/not-contains, and prompt-injection smoke checks.
- Saves machine-readable JSON results.
- Produces ranked models with primary/fallback recommendation and score/latency/error-rate reasons.
- Generates a human-readable Markdown report with failed-case details.
- Can export a Promptfoo config so Promptfoo can be used separately when installed.

## Commands

```powershell
npm test
npm run lint
npm run bench:sample -- --output results/sample-results.json --report results/sample-report.md
```

Discover models from a real endpoint:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
npm run models -- --output results/models.json
```

Run benchmark and report against a real endpoint:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "model-a,model-b"
$env:ROUTEBENCH_TIMEOUT_MS = "120000"
npm run bench -- --output results/model-results.json --report results/model-report.md
```

Generate a report from existing result JSON:

```powershell
npm run report -- --input results/model-results.json --output results/model-report.md
```

`OPENAI_BASE_URL` and `OPENAI_API_KEY` also work as fallbacks.

For local 9router with an internal/self-signed HTTPS certificate, Node may need:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

Use this only for trusted local validation. Prefer trusting the local certificate when possible.

## Promptfoo Config

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "model-a,model-b"
npm run promptfoo:config
npx promptfoo@latest eval -c promptfooconfig.yaml --output results/promptfoo-results.json
```

Promptfoo is consumed through npm/npx; cloning Promptfoo is not required unless changing Promptfoo itself.

## Result shape

`results/*.json` uses schema version `routebench.phase0.v1` and includes:

- `models` — model IDs benchmarked.
- `test_cases` — benchmark case metadata, including category.
- `results` — per-model/per-case raw output, score, latency, status, usage, category, and structured errors.
- `aggregate` — per-model overall score, average latency, and error rate.
- `recommendation` — ranked models, primary model, fallback models, and score/latency/error-rate reasons.

## Markdown report

`results/*.md` includes:

- Run summary.
- Primary and fallback recommendation.
- Ranked model table.
- Category breakdown.
- Failed cases with clear error details.
- Output snippets for failed or low-scoring cases.

## Files

- `src/cli.js` — command entrypoint.
- `src/cliCore.js` — CLI orchestration, file writing, report integration.
- `src/modelsClient.js` — OpenAI-compatible `/models` discovery client.
- `src/openaiClient.js` — OpenAI-compatible chat completions client.
- `src/runner.js` — benchmark loop.
- `src/scoring.js` — deterministic scorers, aggregation, recommendation.
- `src/report.js` — Markdown report renderer.
- `src/promptfoo.js` — Promptfoo YAML export.
- `benchmarks/phase0.json` — 30-case deterministic benchmark pack.
- `test/*.test.js` — Node test suite.
