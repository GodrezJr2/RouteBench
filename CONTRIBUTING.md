# Contributing to RouteBench

Thanks for your interest. RouteBench is a local-first benchmarking tool with no required network services, so the dev loop is fast.

## Getting started

```bash
git clone https://github.com/GodrezJr2/RouteBench
cd RouteBench
npm test          # 201 tests, no endpoint or API key needed
npm run lint      # syntax check
npm run demo      # offline sample benchmark + report
```

There are no production dependencies to install — RouteBench runs on the Node 22+ standard library (it uses built-in `node:sqlite`). `promptfoo` is an optional peer used only by the export command.

## Project layout

| Area | Where |
|---|---|
| CLI commands | `src/cli.js`, `src/cliCore.js` |
| OpenAI-compatible client | `src/openaiClient.js` |
| Scorers + recommendation | `src/scoring.js`, `src/codeExec.js`, `src/agentic.js` |
| Reports + dashboard | `src/report.js`, `src/profile.js`, `src/viewerServer.js`, `src/dashboard.html` |
| Benchmark packs | `benchmarks/*.json` |
| Tests | `test/*.test.js` (Node's built-in `node --test`) |

## Pull requests

1. **Branch** off `main`.
2. **Write a test first.** Every behavior change needs coverage in `test/`. Tests are plain `node:test` + `node:assert` — no framework.
3. **Keep it deterministic.** Scorers must not depend on a live model. Tests that need `python` / `javac` / `java` runtimes already self-skip when those are absent — follow that pattern.
4. **Run the gate:** `npm run lint && npm test` must pass.
5. Keep PRs focused. One concern per PR.

## Adding a benchmark pack

Packs are JSON arrays of test cases. Each case has a `prompt`, a `scoring` mode (`exact`, `json_schema`, `contains`, `code_unit_test`, `code_exec`, `prompt_injection`), `expected` data, and a `category`. Add the file under `benchmarks/`, then wire an `npm run bench:<name>` script in `package.json` if it deserves a shortcut.

## Security

Model-generated code runs via `spawnSync` with an **argument array (no shell)** in a throwaway temp dir — never via a shell string. Preserve that. Never log or persist API keys; they stay in process memory only. See [`README.md`](README.md#security).

## Reporting bugs

Open an issue with the command you ran, the benchmark pack, and the observed vs. expected behavior. Redact any endpoint URLs or keys.
