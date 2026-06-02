# RouteBench

Local-first CLI for benchmarking and comparing models behind an OpenAI-compatible router endpoint.

**Quickstart (no endpoint needed):**

```powershell
git clone https://github.com/GodrezJr2/RouteBench
cd RouteBench
npm run demo
```

Opens `results/demo-report.md` — a full Markdown report comparing two sample models.

---

## Real endpoint

**Step 1** — Copy the example config:

```powershell
Copy-Item routebench.config.example.json routebench.config.json
```

**Step 2** — Edit `routebench.config.json`:

```json
{
  "base_url": "https://your-router.example.com/v1",
  "api_key": "sk-...",
  "models": ["model-a", "model-b"],
  "timeout_ms": 30000,
  "model_costs": {
    "model-a": { "input_per_1k": 0.003, "output_per_1k": 0.015 }
  }
}
```

`routebench.config.json` is gitignored — it will not be committed.

**Step 3** — Run:

```powershell
npm run bench -- --output results/results.json --report results/report.md --route-output results/routing.json
```

---

## Commands

```powershell
npm run demo                                # offline sample benchmark + report
npm run view                                # local result viewer at http://localhost:3001
npm test                                    # run test suite
npm run lint                                # syntax check
```

Discover models:

```powershell
npm run models -- --output results/models.json
```

Full benchmark with report and routing export:

```powershell
npm run bench -- --output results/results.json --report results/report.md --route-output results/routing.json
```

Use the richer 36-case Phase 1 pack (six PRD MVP categories incl. coding) and run requests in parallel:

```powershell
$env:ROUTEBENCH_CONCURRENCY = "6"
npm run bench -- --benchmark benchmarks/phase1.json --output results/results.json --report results/report.md --route-output results/routing.json
```

The routing export includes `category_rules`: the best model to route each task type to (task-based routing, not one model for everything).

Open the local dashboard (serves `results/` on localhost:3001):

```powershell
npm run view
```

The dashboard can: enter an endpoint + API key (or read them from `routebench.config.json`), discover models, filter/search and select which to benchmark, run a benchmark with live progress (current model, elapsed, ETA), and view ranked results. Result tables are sortable; failed cases expand to show the full error and model output; and each result can be downloaded as JSON, a Markdown report, or a routing-export JSON. The API key stays in process memory only and is never written to disk or returned to the browser.

Compare two benchmark runs (regression/improvement diff):

```powershell
npm run compare -- --baseline results/run1.json --candidate results/run2.json --output results/compare.json --report results/compare.md
```

Convert routing export to LiteLLM or generic router config:

```powershell
npm run routing:export -- --input results/routing.json --format litellm --output results/litellm-config.yaml
npm run routing:export -- --input results/routing.json --format generic --output results/generic-config.json
```

See `docs/routing-adapters.md` for field mapping details and 9router / LiteLLM usage notes.

Generate report from existing result JSON:

```powershell
npm run report -- --input results/results.json --output results/report.md
```

Promptfoo config export:

```powershell
npm run promptfoo:config
npx promptfoo@latest eval -c promptfooconfig.yaml --output results/promptfoo-results.json
```

For local endpoints with internal/self-signed HTTPS certs:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

Use only for trusted local endpoints. Prefer trusting the cert via OS/Node trust store.

---

## Config file

`routebench.config.json` (gitignored, never committed):

| Field | Description |
|---|---|
| `base_url` | OpenAI-compatible endpoint, e.g. `https://router.example.com/v1` |
| `api_key` | API key — also accepted from `ROUTEBENCH_API_KEY` env var |
| `models` | Array of model IDs to benchmark |
| `timeout_ms` | Per-request timeout in ms (default: 30000) |
| `concurrency` | Parallel benchmark requests (default: 4) |
| `model_costs` | Optional per-model cost config for cost estimation |

Environment variables (`ROUTEBENCH_BASE_URL`, `ROUTEBENCH_API_KEY`, `ROUTEBENCH_MODELS`, `ROUTEBENCH_TIMEOUT_MS`, `ROUTEBENCH_CONCURRENCY`) override config file values. `OPENAI_BASE_URL` and `OPENAI_API_KEY` also work as fallbacks.

### Optional LLM-as-judge

Open-ended categories (summarization, Indonesian QA) are scored by deterministic string matching by default. To score them semantically, set a judge model:

```powershell
$env:ROUTEBENCH_JUDGE_MODEL = "gh/gpt-4o-mini"
# optional: override which categories the judge handles (comma-separated)
$env:ROUTEBENCH_JUDGE_CATEGORIES = "summarization_quality,indonesian_qa"
```

The judge returns a 0–100 score with a one-line reason (stored as `judge_reason`). If the judge call fails, the run falls back to deterministic scoring for that case (`scored_by: "deterministic_fallback"`) instead of dropping it. Leave `ROUTEBENCH_JUDGE_MODEL` unset to keep runs fully deterministic.

---

## Output files

### `results/*.json` — `routebench.phase0.v1`

- `models` — model IDs benchmarked
- `test_cases` — 30-case benchmark pack with categories
- `results` — per-case output, score, latency, status (`completed` / `provider_error` / `model_failure` / `scorer_failure`), structured error fields
- `aggregate` — per-model overall score, avg latency, error rate, total estimated cost
- `recommendation` — ranked models with score/latency/error-rate reasons

### `results/*.md` — Markdown report

- Primary and fallback recommendation with reasons
- Ranked model table
- Category breakdown
- Failed cases with error type, message, and output snippet

### `results/routing.json` — `routebench.routing.v1`

Clean routing export for ops/router config use — no API key included:

```json
{
  "schema_version": "routebench.routing.v1",
  "primary_model": "model-a",
  "fallback_models": ["model-b"],
  "routing_rules": [
    { "priority": 1, "model": "model-a", "route_score": 80, "reason": "..." }
  ]
}
```

---

## Architecture

```
routebench.config.json + env vars
↓
/v1/models discovery
↓
/v1/chat/completions benchmark (30 deterministic cases)
↓
deterministic scorers (exact, JSON, contains, prompt-injection)
↓
aggregation + weighted recommendation
↓
results/*.json + results/*.md + results/routing.json
```

Key files:

- `src/cli.js` — command entrypoint
- `src/cliCore.js` — orchestration, file writing, redaction safeguards
- `src/config.js` — config file + env loading, merging
- `src/modelsClient.js` — `/models` discovery
- `src/openaiClient.js` — `/chat/completions` client
- `src/runner.js` — benchmark loop, cost calculation, result classification
- `src/scoring.js` — scorers, aggregation, recommendation
- `src/report.js` — Markdown renderer
- `src/routeExport.js` — routing JSON export + schema validation
- `src/promptfoo.js` — Promptfoo YAML export
- `benchmarks/phase0.json` — 30-case benchmark pack
