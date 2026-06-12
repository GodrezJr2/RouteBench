export const PRESETS = {
  'opencode-free': {
    name: 'OpenCode Free (9router)',
    description: 'Active free models from the OpenCode provider on 9router. No API key required by the provider itself.',
    models: [
      'oc/deepseek-v4-flash-free',
      'oc/nemotron-3-ultra-free',
      'oc/north-mini-code-free',
      'oc/mimo-v2.5-free',
    ],
    timeout_ms: 120000,
    concurrency: 2,
    routing_preference: 'quality',
  },
  'opencode-free-extended': {
    name: 'OpenCode Free Extended',
    description: 'OpenCode Free active models plus suggested models.',
    models: [
      'oc/deepseek-v4-flash-free',
      'oc/nemotron-3-ultra-free',
      'oc/north-mini-code-free',
      'oc/mimo-v2.5-free',
      'oc/big-pickle',
      'oc/qwen3.6-plus-free',
    ],
    timeout_ms: 120000,
    concurrency: 2,
    routing_preference: 'quality',
  },
  'opencode-free-code': {
    name: 'OpenCode Free Code-Focused',
    description: 'Code-optimized subset for claude-code routing: deepseek-v4-flash, north-mini-code, nemotron-3-ultra.',
    models: [
      'oc/deepseek-v4-flash-free',
      'oc/north-mini-code-free',
      'oc/nemotron-3-ultra-free',
    ],
    timeout_ms: 120000,
    concurrency: 2,
    routing_preference: 'quality',
  },
  'opencode-free-frontier': {
    name: 'OpenCode Free — Frontier Eval',
    description: 'All 4 active OpenCode Free models against the harder frontier benchmark (DP, graph, JS semantics, security detection).',
    models: [
      'oc/deepseek-v4-flash-free',
      'oc/north-mini-code-free',
      'oc/nemotron-3-ultra-free',
      'oc/mimo-v2.5-free',
    ],
    timeout_ms: 120000,
    concurrency: 2,
    routing_preference: 'quality',
  },
  'opencode-free-code-assistant': {
    name: 'OpenCode Free — Code Assistant Eval',
    description: 'All 4 active OpenCode Free models against the code-assistant benchmark: code repair, architecture decisions, security audit, backend patterns, scheduler logic, prompt injection.',
    models: [
      'oc/deepseek-v4-flash-free',
      'oc/north-mini-code-free',
      'oc/nemotron-3-ultra-free',
      'oc/mimo-v2.5-free',
    ],
    timeout_ms: 120000,
    concurrency: 2,
    routing_preference: 'quality',
  },
};

export function listPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({ id, ...preset }));
}

export function getPreset(id) {
  const preset = PRESETS[id];
  if (!preset) {
    throw new Error(`Unknown preset "${id}". Available: ${Object.keys(PRESETS).join(', ')}`);
  }
  return preset;
}

export function formatPresetsTable() {
  const lines = ['Available presets', ''];
  for (const [id, preset] of Object.entries(PRESETS)) {
    lines.push(`  ${id}`);
    lines.push(`    ${preset.name}`);
    lines.push(`    ${preset.description}`);
    lines.push(`    Models (${preset.models.length}):`);
    for (const m of preset.models) lines.push(`      - ${m}`);
    lines.push(`    timeout_ms=${preset.timeout_ms}  concurrency=${preset.concurrency}  prefer=${preset.routing_preference}`);
    lines.push('');
  }
  lines.push('Usage:');
  lines.push('  npm run bench -- --preset opencode-free --output results/opencode-results.json --report results/opencode-report.md');
  lines.push('  npm run bench -- --preset opencode-free-code --benchmark benchmarks/claude-code-compat.json --output results/code-results.json --report results/code-report.md');
  return lines.join('\n');
}
