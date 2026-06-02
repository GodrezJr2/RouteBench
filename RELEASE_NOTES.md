# RouteBench v1.1.0 Release Notes

## What's new in v1.1.0

### Interactive local dashboard (Phase 1.1)

`npm run view` now opens a full interactive dashboard — not just a result viewer.

**Run panel** — new collapsible section in the dashboard:
- Shows configured endpoint URL and whether an API key is set (key itself is never exposed)
- **Discover Models** button — calls the endpoint's `/models` API and lists all available models as checkboxes
- Select which models to benchmark (at least 2 required to start)
- Benchmark pack selector — lists available packs in `benchmarks/` with case counts
- **Start Benchmark** button — runs the full benchmark on the server, streams progress (case count + percentage bar), and auto-loads the result when done
- Handles errors (endpoint not configured, network failure, etc.) with inline messages

**New API endpoints** served by the viewer at `127.0.0.1:3001`:
- `GET /api/config` — returns endpoint config summary (base URL, key presence, models, timeout); never returns the raw API key
- `GET /api/benchmarks` — lists benchmark packs with metadata
- `POST /api/discover` — proxies model discovery to the configured endpoint
- `POST /api/run` — starts a benchmark run, returns a run ID; run state is in-memory only
- `GET /api/run?id=...` — returns run status, progress, and result path when complete

**Progress tracking** — `runBenchmark()` now accepts an `onProgress(done, total)` callback that fires after each model×case pair completes.

All constraints from Phase 1.0 still apply: local-first, single-user, no auth, no database, no SaaS, no LLM-as-judge, no architecture changes to the CLI core.

---

# RouteBench v0.7.0 Release Notes

## What is RouteBench

RouteBench is a local-first CLI for benchmarking LLM models behind an OpenAI-compatible router endpoint. It runs a deterministic 30-case benchmark pack, scores each model, and produces ranked recommendations with a clean routing export — no server, no database, no account required.

---

## What works in v0.7.0

### Model discovery
`npm run models` calls `/v1/models` on your endpoint and lists all available model IDs with owner.

### Benchmark
`npm run bench` runs 30 deterministic cases across all configured models. Cases cover:
- Exact arithmetic
- JSON field compliance
- Indonesian QA and summarization
- Instruction following
- Prompt injection resistance

Each result row records output, score, latency, token usage, estimated cost, and a fine-grained status:

| Status | Meaning |
|---|---|
| `completed` | Model responded and scorer ran |
| `provider_error` | HTTP error, timeout, or network failure |
| `model_failure` | Model returned empty output |
| `scorer_failure` | Model responded but scorer threw |

### Scoring
Four deterministic scorers — no LLM-as-judge:
- `exact` — output must match expected text exactly
- `json_schema` — output must be valid JSON with required fields at expected values
- `contains` / `not_contains` — output must include/exclude specific strings
- `prompt_injection` — output must not reveal forbidden content

### Recommendation
Weighted formula: quality (65%) + reliability (25%) + latency (10%). Output includes primary model, fallback order, and a human-readable reason per model.

### Cost estimation
Optional. Add `model_costs` to `routebench.config.json` with `input_per_1k` and `output_per_1k` rates. Estimated cost appears per result row and as `total_estimated_cost_usd` in the aggregate.

### Reports
`--report` flag generates a Markdown file with ranked model table, category breakdown, and failed-case details including error type, message, and output snippet.

### Routing export
`--route-output` flag writes a `routebench.routing.v1` JSON file — clean, ops-ready, priority-ordered routing rules. No API key included. Can be validated with `validateRouteExport()`.

### Offline demo
`npm run demo` runs a sample benchmark with two fixture models. No endpoint or API key needed. Produces `results/demo-report.md`.

---

## Commands

```powershell
npm run demo                     # offline sample, no endpoint needed

npm run models -- --output results/models.json

npm run bench -- \
  --output results/results.json \
  --report results/report.md \
  --route-output results/routing.json

npm run report -- \
  --input results/results.json \
  --output results/report.md

npm test
npm run lint
```

---

## Example workflow

```powershell
# 1. Copy and edit config
Copy-Item routebench.config.example.json routebench.config.json
# edit routebench.config.json with your endpoint, key, models

# 2. Discover available models
npm run models -- --output results/models.json

# 3. Run benchmark
npm run bench -- --output results/results.json --report results/report.md --route-output results/routing.json

# 4. Read the report
# results/report.md  — ranked models, category breakdown, failed cases
# results/routing.json — clean routing config, no API key
```

For local endpoints with self-signed HTTPS certs:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

---

## Security

- **API key redaction**: all output files (JSON results, Markdown reports) are scrubbed of the API key before being written to disk, even if the key somehow appears in provider error messages.
- **Routing export**: `routebench.routing.v1` never includes `api_key`, `authorization`, or any bearer token. Safe to commit or share with ops teams.
- **Config file**: `routebench.config.json` is gitignored by default. Do not commit it. Use `routebench.config.example.json` (placeholder values, committed) as the template.
- **TLS**: `NODE_TLS_REJECT_UNAUTHORIZED=0` disables certificate verification. Use only for trusted local endpoints; prefer OS/Node certificate trust for everything else.

---

## Current limitations

- Benchmark pack is fixed (30 cases, English + Indonesian). Custom benchmark packs not yet supported.
- Scoring is fully deterministic — no LLM-as-judge, no semantic similarity.
- No retry or backoff. Flaky providers produce error rows, not retries.
- No parallelism. Cases run sequentially per model.
- No persisted run history. Each benchmark run overwrites previous output files unless you change the `--output` path.
- Cost estimation requires manually specifying rates in `model_costs`; no automatic provider pricing lookup.
- No dashboard, auth, database, queue, or SaaS surface.

---

## Roadmap (not committed)

Likely next areas in priority order:

1. **Config file UX** — `routebench init` command to generate `routebench.config.json` interactively.
2. **Retry and backoff** — per-case retry with configurable limit for flaky upstreams.
3. **Benchmark packs** — support for custom case files alongside the built-in pack.
4. **Router config export** — structured export compatible with common router formats (e.g. LiteLLM, custom proxy config).
5. **Run history** — append mode for results, simple run comparison.

These are not scoped or scheduled. The CLI is intentionally narrow until the benchmark workflow is stable against real endpoints.
