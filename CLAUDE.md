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

List available model presets:

```powershell
npm run presets
```

Discover models from an OpenAI-compatible endpoint:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
npm run models -- --output results/models.json
# filter to a specific provider prefix (e.g., oc/ for OpenCode Free):
npm run models:opencode
npm run models -- --filter-provider oc --output results/oc-models.json
```

Quick start — OpenCode Free models on 9router (no manual model list needed):

```powershell
# copy the example config and edit base_url / api_key
cp routebench.config.opencode.example.json routebench.config.json
# run against all 4 active OpenCode Free models (phase0 benchmark)
npm run bench:opencode
# run against 3 code-focused models with the code-compat benchmark
npm run bench:opencode-code
# run harder frontier benchmark (39 cases: DP, graph, JS semantics, security detection)
npm run bench:frontier
# run code assistant benchmark (30 cases: code repair, architecture, security, backend patterns, scheduler, injection)
npm run bench:code-assistant
# run agentic harness (multi-turn repo repair — measures capability the single-turn packs cannot)
$env:ROUTEBENCH_BASE_URL = "http://your-router/v1"; $env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "oc/north-mini-code-free,kr/claude-sonnet-4.6"
npm run bench:agentic
```

Run benchmark and Markdown report against a real endpoint:

```powershell
$env:ROUTEBENCH_BASE_URL = "https://your-router.example.com/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "model-a,model-b"
$env:ROUTEBENCH_TIMEOUT_MS = "120000"
npm run bench -- --output results/model-results.json --report results/model-report.md
# with a preset (overrides ROUTEBENCH_MODELS when not set):
npm run bench -- --preset opencode-free --output results/opencode-results.json --report results/opencode-report.md
# with the code-compat benchmark pack:
npm run bench:code-compat
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
- `src/presets.js` — built-in provider presets (opencode-free, opencode-free-extended, opencode-free-code, opencode-free-frontier).
- `src/modelsClient.js` — OpenAI-compatible `/models` discovery client.
- `src/openaiClient.js` — OpenAI-compatible chat completions client with 9router JSON trailer handling and structured errors. Exports `createOpenAICompatibleClient` (single-turn, testCase→messages) and `createChatClient` (multi-turn, raw messages array) over a shared retry/temperature/parse core.
- `src/agentic.js` — multi-turn agentic harness: runs a model through a broken-repo fix loop (gets failing tests → edits files via `// FILE:` blocks → re-runs `node --test` → repeats to maxTurns). Scores pass/fail + turns-to-green. Measures iterative repo-repair capability the single-turn packs cannot. spawnSync uses an args array (no shell); model code runs in a throwaway temp dir — local-benchmark trust level only.
- `scripts/agentic-eval.mjs` — agentic eval runner + task fixtures (cart-repair, schedule-repair). `npm run bench:agentic`. Reads ROUTEBENCH_MODELS/BASE_URL/API_KEY/MAX_TURNS; writes results/agentic-results.json + agentic-report.md.
- `src/runner.js` — benchmark loop across models and cases; model errors become result rows.
- `src/scoring.js` — exact, JSON schema, contains, code_unit_test, code_exec, prompt-injection scoring; aggregation (category/difficulty/language); recommendation reasons.
- `src/extractCode.js` — shared fenced-code-block extractor used by scoring.js and codeExec.js.
- `src/codeExec.js` — multi-language execution scorer (`code_exec`): runs model-generated Python / Java / JavaScript against unit-test cases via real runtimes (python, javac+java, node) in a temp dir, returns pass-ratio. Enables real per-language profiling. Constrained Java types: int, boolean, String, int[]. spawnSync (args array, no shell); local-benchmark trust level only.
- `src/report.js` — Markdown report renderer (incl. Per-Language Breakdown + Token Usage & Cache sections).
- `src/dashboard.html` — the unified dashboard (light/warm editorial aesthetic: white surfaces, orange `#f97316` accent, soft shadows, rounded cards — matches `compare.html`), served at `/` with `/dashboard` as a compatibility alias. A complete tool in one page: (1) a **Connect & Run** deck — any OpenAI-compatible endpoint (quick chips: Ollama/LM Studio/llama.cpp/vLLM/OpenRouter, or custom), `/api/discover` → searchable model multi-select → benchmark-pack picker + max-cases → `/api/run` with a live progress bar → auto-loads the finished run; (2) the **visual report** — editorial hero + derived verdict, Profile Cards with role badges, per-language heatmap centerpiece, agentic repo-repair, rankings, category/difficulty bars, token-cost strip. Live: `/api/runs` run selector + `/api/dashboard?path=` payload; sections auto-hide when absent; empty/loading/error states. No endpoint hardcoded (generic, not 9router-specific). Falls back to a baked snapshot as a static file. `docs/dashboard.png` = README screenshot.
- `src/profile.js` — also exports `buildDashboard(result, agenticRows)` → the dashboard payload (profiles + languages + ranked + categories + difficulty + tokens + derived verdict; agentic filtered to the run's models).
- `src/compare.html` — dedicated multi-turn chat-compare room, served at `/compare`. Big side-by-side conversation columns (assistant replies prominent, user prompts as compact bubbles), model chips (add/remove), slim bottom prompt bar (Enter to send), settings popover (endpoint + system prompt). Maintains per-model conversation history; sends `{requests:[{model,messages}]}` to `/api/chat-compare`. Linked from the dashboard top nav.
- `src/viewerServer.js` — viewer HTTP server: serves `/` and `/dashboard` (unified benchmark tool), `/compare` (chat-compare room), and `/api/*` — `files`, `runs` (result files w/ summaries), `dashboard` (built payload, auto-merges `results/agentic-results.json`), `run`, `discover`, `chat-compare` (single-turn `{models,system,prompt}` OR multi-turn `{requests:[{model,messages}]}` → outputs side by side via `createChatClient`, per-model error isolation), `export`.
- `src/profile.js` — Model Profile Cards: fuses overall quality + latency + tokens/cache + per-category + per-language + per-difficulty + optional agentic repo-repair into ONE per-model verdict with a role tag (DAILY DRIVER / HEAVY CODER / SPECIALIST / LIMITED) and use-for / avoid-for guidance. `node src/cli.js profile --input <results.json> [--agentic <agentic-results.json>]` (`npm run profile`).
- `src/promptfoo.js` — Promptfoo YAML export.
- `benchmarks/phase0.json` — 30-case general router smoke benchmark.
- `benchmarks/claude-code-compat.json` — 26-case code generation + reasoning + injection benchmark for claude-code routing.
- `benchmarks/frontier.json` — 39-case single-turn benchmark: DP/graph algorithms with greedy traps, JS runtime semantics, security vuln detection, complexity analysis, bug classification, hard prompt injection. Empirically does NOT separate frontier from capable free models (measured: free OpenCode models and GPT-5.5/Sonnet-4.6 all score 92-100). Validates a baseline quality threshold + compares latency/injection resistance, not model intelligence.
- `benchmarks/code-assistant.json` — 30-case benchmark for evaluating paid models as Claude Code / coding assistant replacements: code repair (7 JS bug fixes), architecture decisions (5), security audit (5), backend patterns (5), scheduler logic (4), prompt injection hard (4).
- `benchmarks/polyglot-hard.json` — 18-case hard pack for per-language profiling: 12 execution cases (4 hard algorithms — trap rain water, coin change with greedy trap, longest valid parens, Kadane — each in Python/Java/JavaScript, run for real via `code_exec`) tagged by `metadata.language` to drive the Per-Language Breakdown, plus 6 CWE/security detection cases (language-agnostic reasoning). `npm run bench:polyglot`.
- `routebench.config.opencode.example.json` — ready-to-use config for 9router + OpenCode Free.
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
