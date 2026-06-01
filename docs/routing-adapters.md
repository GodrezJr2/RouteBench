# Routing Adapters

RouteBench produces a `routebench.routing.v1` JSON file from each benchmark run. The `routing-export` command converts this into adapter-specific config formats for use with real routers.

---

## Workflow

```
npm run bench -- --route-output results/routing.json
↓
npm run routing:export -- --input results/routing.json --format litellm --output results/litellm-config.yaml
npm run routing:export -- --input results/routing.json --format generic --output results/generic-config.json
```

Or as a single pipeline:

```powershell
npm run bench -- \
  --output results/results.json \
  --report results/report.md \
  --route-output results/routing.json

npm run routing:export -- \
  --input results/routing.json \
  --format litellm \
  --output results/litellm-config.yaml
```

---

## Formats

### `generic` (default)

`routebench.generic-router.v1` JSON. A neutral priority-ordered format with model scores and a routing hint. Adapt field names for your specific router.

**Command:**
```powershell
npm run routing:export -- --input results/routing.json --format generic --output results/generic-config.json
```

**Example output:** `examples/generic-config.json`

**Field mapping:**

| RouteBench field | Generic config field | Notes |
|---|---|---|
| `primary_model` | `default_model` | Use as the first-choice model |
| `fallback_models` | `fallback_chain` | Ordered list of fallbacks |
| `routing_rules[].model` | `models[].id` | Model identifier |
| `routing_rules[].priority` | `models[].priority` | 1 = highest priority |
| `routing_rules[].route_score` | `models[].route_score` | Weighted score (quality + reliability + latency) |
| `routing_rules[].error_rate` | `models[].error_rate` | 0 = no failures |
| `routing_rules[].avg_latency_ms` | `models[].avg_latency_ms` | Average per-case latency |

---

### `litellm`

LiteLLM router config YAML. Compatible with [LiteLLM's model list + router_settings format](https://docs.litellm.ai/docs/routing).

**Command:**
```powershell
npm run routing:export -- --input results/routing.json --format litellm --output results/litellm-config.yaml
```

**Example output:** `examples/litellm-config.yaml`

**Notes:**
- API key is referenced as `os.environ/ROUTEBENCH_API_KEY` — never a literal value
- `api_base` points to the endpoint from your `routebench.config.json`
- Score/latency/error-rate from RouteBench are included as `model_info` comments for reference
- Default `routing_strategy: latency-based-routing` — change to `simple-shuffle`, `least-busy`, or `usage-based-routing` as needed
- `num_retries: 2` and `timeout: 30` are sensible defaults — tune for your use case

**To use with LiteLLM:**
```bash
pip install litellm
litellm --config results/litellm-config.yaml --port 4000
```

---

## Field mapping from routebench.routing.v1

| RouteBench field | Meaning | How to use in router |
|---|---|---|
| `primary_model` | Highest-ranked model by weighted score | Set as default/primary |
| `fallback_models` | All other models, ordered by rank | Set as ordered fallback chain |
| `routing_rules[].route_score` | Weighted score: quality (65%) + reliability (25%) + latency (10%) | Use for weight-based routing |
| `routing_rules[].overall_score` | Raw benchmark score (0–100) | Quality gate — skip models below threshold |
| `routing_rules[].error_rate` | Fraction of failed requests (0–1) | Reliability gate — avoid models above threshold |
| `routing_rules[].avg_latency_ms` | Average request latency in ms | Latency-based routing weight |

---

## 9router / custom OpenAI-compatible router

9router and similar custom routers vary in config format. Use the `generic` export as a starting point and map fields manually:

```json
{
  "default_model": "ComboOP",
  "fallback_chain": ["gh/gpt-4o-mini"]
}
```

Typical mapping for a priority-based router:

```json
{
  "models": [
    { "id": "ComboOP",       "weight": 100, "priority": 1 },
    { "id": "gh/gpt-4o-mini", "weight": 0,   "priority": 2 }
  ]
}
```

The `route_score` field (0–100) can be used directly as a weight if your router supports weight-based selection.

---

## Security

Neither export format includes the API key. The LiteLLM format references it via `os.environ/ROUTEBENCH_API_KEY` — set the env var before starting LiteLLM:

```powershell
$env:ROUTEBENCH_API_KEY = "sk-..."
litellm --config results/litellm-config.yaml
```

The generic config JSON is safe to commit and share — it contains only model IDs, scores, latency, and endpoint URL.
