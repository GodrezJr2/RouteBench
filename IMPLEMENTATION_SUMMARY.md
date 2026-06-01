# RouteBench Phase 0.5 Implementation Summary

## What Works

RouteBench Phase 0.5 is a local-first Node.js CLI. Full flow validated against the user's 9router endpoint:

- Discover models from `/v1/models` — 126 models returned from real 9router
- Run 30-case deterministic benchmark across 2+ models
- Save machine-readable JSON (`routebench.phase0.v1`)
- Generate Markdown report with ranked models, recommendation, category breakdown, failed cases
- Ranked models show route score, overall score, latency, error rate, and score/latency/error-rate reasons
- Failed cases show error type, provider error message, and output snippet

### Real 9router result (2026-06-01)

- Endpoint: `https://9router.home/v1`
- Models: `ComboOP`, `gh/gpt-4o-mini`
- ComboOP: route_score=80, overall=82, latency=7834ms, error_rate=0%
- gh/gpt-4o-mini: route_score=75, overall=69, latency=1151ms, error_rate=17%
- Primary recommendation: `ComboOP` (usable quality, moderate latency, no failures)
- Fallback: `gh/gpt-4o-mini` (fast but 5/5 prompt-injection cases returned 422)

## How To Run

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:ROUTEBENCH_BASE_URL = "https://9router.home/v1"
$env:ROUTEBENCH_API_KEY = "sk-..."

# Discover models
npm run models -- --output results/models.json

# Run benchmark + report
$env:ROUTEBENCH_MODELS = "ComboOP,gh/gpt-4o-mini"
$env:ROUTEBENCH_TIMEOUT_MS = "120000"
npm run bench -- --output results/9router-results.json --report results/9router-report.md

# Sample (no endpoint needed)
npm run bench:sample -- --output results/sample-results.json --report results/sample-report.md

# Report from existing JSON
npm run report -- --input results/9router-results.json --output results/9router-report.md
```

## Integration Notes

- Node.js `fetch` rejects the local `https://9router.home` cert. Use `NODE_TLS_REJECT_UNAUTHORIZED=0` for local validation only; prefer trusting the cert via OS/Node trust store.
- 9router responses can contain normal JSON followed by `data: [DONE]`. The client extracts the first JSON object so those parse correctly.
- Provider errors are preserved as result rows (not crashes). `gh/gpt-4o-mini` returned 422 for all 5 prompt-injection cases; RouteBench still completed the run.

## Current Limitations

- Scoring is deterministic only; no LLM-as-judge.
- No cost estimation beyond raw usage token counts.
- No retry/backoff or request parallelism.
- No router config export from recommendation.
- No auth, database, queue, SaaS, or dashboard.
- Recommendation formula: quality + reliability + latency only.

## Next Recommended Milestone (Phase 1)

Stay narrow:

1. Add a small config file so models/URL/key don't need env vars every run.
2. Add retry/backoff with per-case timeout reporting.
3. Export a router config JSON from the recommendation output.
4. Keep everything CLI-only until the workflow is stable.
