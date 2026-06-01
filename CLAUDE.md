# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
npm test
npm run lint
npm run bench:sample -- --output results/sample-results.json --report results/sample-report.md
```

Run one test file:

```powershell
node --test test/scoring.test.js
```

Discover models from an OpenAI-compatible endpoint:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
npm run models -- --output results/models.json
```

Run benchmark and Markdown report against a real endpoint:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "model-a,model-b"
$env:ROUTEBENCH_TIMEOUT_MS = "120000"
npm run bench -- --output results/model-results.json --report results/model-report.md
```

Generate report from existing result JSON:

```powershell
npm run report -- --input results/model-results.json --output results/model-report.md
```

Generate a Promptfoo config and run Promptfoo through npm/npx:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "model-a,model-b"
npm run promptfoo:config
npx promptfoo@latest eval -c promptfooconfig.yaml --output results/promptfoo-results.json
```

Promptfoo is used as a CLI/package dependency; do not clone the Promptfoo repo unless modifying Promptfoo itself.

For local 9router with internal/self-signed HTTPS certs, Node may need `NODE_TLS_REJECT_UNAUTHORIZED=0` for validation. Prefer trusting the local cert when possible.

## Current Scope

This repo implements RouteBench Phase 0.5: a local-first CLI proof-of-concept for discovering models, benchmarking at least two OpenAI-compatible models, saving machine-readable JSON, generating a Markdown report, and producing ranked primary/fallback recommendations.

Do not expand into full PRD scope yet. Avoid auth, database, SaaS, queue workers, dashboards, multi-tenant isolation, custom benchmark uploads, RAG evaluation, or LLM-as-judge scoring unless explicitly requested.

## Product Context

RouteBench is specified as an LLM router benchmark and optimization platform. Its core flow is:

```txt
Connect endpoint → Discover models → Run benchmark → Analyze result → Recommend routing rule
```

Main differentiator: RouteBench is router-first, not leaderboard-first. Benchmark output should lead to task-based model routing decisions and exportable routing config.

## Phase 0.5 Architecture

The implemented Phase 0.5 path is a Node.js CLI:

```txt
CLI/env vars
↓
/models discovery + benchmark pack JSON
↓
OpenAI-compatible /chat/completions client
↓
deterministic scorers
↓
aggregate model metrics
↓
weighted recommendation with reasons
↓
results/*.json + results/*.md
```

Key files:

- `src/cli.js` — command entrypoint.
- `src/cliCore.js` — command parsing, live/sample orchestration, discovery and report file writing.
- `src/modelsClient.js` — OpenAI-compatible `/models` discovery client.
- `src/openaiClient.js` — OpenAI-compatible chat completions client with 9router JSON trailer handling and structured errors.
- `src/runner.js` — benchmark loop across models and cases; model errors become result rows.
- `src/scoring.js` — exact, JSON schema, contains, prompt-injection smoke scoring; aggregation; recommendation reasons.
- `src/report.js` — Markdown report renderer.
- `src/promptfoo.js` — Promptfoo YAML export.
- `benchmarks/phase0.json` — 30-case deterministic benchmark pack.
- `results/*.json` and `results/*.md` — generated benchmark outputs.

## Result Shape

Generated result JSON uses schema version `routebench.phase0.v1` and includes:

- `models` — model IDs benchmarked.
- `test_cases` — benchmark case metadata with category.
- `results` — per-model/per-case raw output, score, latency, status, usage, category, and structured errors.
- `aggregate` — per-model overall score, average latency, and error rate.
- `recommendation` — ranked models, primary model, fallback models, and score/latency/error-rate reasons.

## PRD Guidance For Later Phases

When moving beyond Phase 0.5, preserve the PRD boundary: reuse open-source eval tools for generic evaluation, but build RouteBench-specific layers in-house for provider UX, model discovery, benchmark packs, orchestration, aggregation, router scoring, recommendations, and config export.

MVP benchmark pack categories from the PRD:

1. Instruction Following Basic.
2. JSON Compliance.
3. Indonesian QA & Slang.
4. Coding Agent Basic.
5. Summarization Quality.
6. Prompt Injection Resistance.

Explicit security/product requirements from the PRD still apply once those surfaces exist: encrypt stored API keys, never return keys to frontend, redact logs, isolate user outputs, enforce external call timeouts, save provider errors as results, and omit API keys from exported router configs by default.
