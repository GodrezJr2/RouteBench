# RouteBench Phase 0.5 Design

## Goal

Improve the existing Phase 0 CLI proof-of-concept without rebuilding architecture. Phase 0.5 remains local-first and continues using the current Node.js CLI, benchmark runner, deterministic scoring, and OpenAI-compatible 9router integration.

Definition of done: a real 9router run can produce a JSON result, readable report, ranked models, primary/fallback recommendation, and clear failed-case details.

## Non-Goals

Do not add auth, database, queue workers, SaaS features, LLM-as-judge, or a full dashboard. Do not rewrite around Promptfoo or replace the working runner.

## Approach

Extend the current CLI in place.

Rejected alternatives:

- Separate reporting tool: adds more moving parts than Phase 0.5 needs.
- HTML-first report: more polish than needed; Markdown is easier to inspect in terminal and GitHub.
- Promptfoo-first rewrite: risks breaking the known-working direct 9router runner.

## CLI Commands

Add a model discovery command:

```powershell
npm run models
node src/cli.js models --output results/models.json
```

It calls:

```txt
GET {ROUTEBENCH_BASE_URL}/models
```

It prints discovered model IDs and writes optional machine-readable JSON when `--output` is provided.

Add a report command:

```powershell
npm run report -- --input results/9router-results.json --output results/9router-report.md
```

Allow benchmark run to write a report in one step:

```powershell
npm run bench -- --output results/9router-results.json --report results/9router-report.md
```

Existing commands remain valid.

## Benchmark Pack

Expand `benchmarks/phase0.json` to around 30 deterministic cases total. Add metadata per case for category-level reporting.

Case groups:

- Exact arithmetic and factual short answers.
- Strict JSON extraction.
- Contains/not-contains Indonesian summary and support answers.
- Instruction-following constraints.
- Prompt-injection smoke checks.

Scoring remains deterministic. No LLM-as-judge.

## Recommendation Output

Keep current weighted recommendation model, but enrich each ranked model with reason fields:

```json
{
  "primary_model": "...",
  "fallback_models": ["..."],
  "ranked_models": [
    {
      "model": "...",
      "recommendation_score": 82,
      "overall_score": 81,
      "avg_latency_ms": 6887,
      "error_rate": 0,
      "score_reason": "...",
      "latency_reason": "...",
      "error_rate_reason": "..."
    }
  ],
  "reason": "..."
}
```

Primary model is the first ranked model. Fallback order follows the remaining ranking.

## Report Output

Generate Markdown report from result JSON.

Sections:

1. Run summary.
2. Primary and fallback recommendation.
3. Ranked model table.
4. Score, latency, and error-rate reasons.
5. Failed cases table with model, test case, status, score, latency, and error message.
6. Per-model category breakdown from test case metadata.
7. Raw output snippets for failed or low-scoring cases.

## Error Messages

Improve failed model-call details only at integration boundary.

Errors should include:

- Model ID.
- Test case ID.
- Error type: provider_http_error, timeout, malformed_provider_json, network_error, or unknown_error.
- HTTP status and provider body preview when available.
- Clear message suitable for report output.

Failed provider calls remain result rows and should not crash the full run.

## Tests and Validation

Use TDD for new behavior:

- Model discovery parses OpenAI-compatible `/models` response.
- Report renderer includes expected sections and failed cases.
- Recommendation includes reason fields.
- Failed calls include model/test case context and error type.
- Benchmark pack has around 30 cases and valid scoring metadata.

Final validation commands:

```powershell
npm run lint
npm test
```

Real 9router validation:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:ROUTEBENCH_BASE_URL = "https://9router.home/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."
$env:ROUTEBENCH_MODELS = "ComboOP,gh/gpt-4o-mini"
npm run models -- --output results/9router-models.json
npm run bench -- --output results/9router-results.json --report results/9router-report.md
```

## Scope Check

This design is one CLI milestone. It extends the current local-first proof-of-concept and does not introduce persistent services or architecture changes.
