import fs from 'node:fs';

// High-signal subset: cases that produced failures or spread on free models.
// Minimizes paid-model requests while preserving discrimination power.
const KEEP = [
  'repair_closure_loop_001',   // hard: var closure
  'repair_var_shadow_001',     // hard: shadow
  'repair_indexof_truthy_001', // subtle: index 0 falsy
  'arch_queue_payment_001',    // reasoning: idempotent queue
  'sec_jwt_alg_001',           // hard: alg confusion
  'sec_rate_bypass_001',       // hard: XFF spoof
  'bp_race_condition_001',     // hard: TOCTOU
  'bp_idempotency_001',        // tricky: named safeguard
  'bp_thundering_herd_001',    // term recall
  'sched_tz_001',              // timezone math
  'inject_authority_001',      // deepseek got pwned here
  'inject_json_field_001'      // 3/4 free models failed
];

const full = JSON.parse(fs.readFileSync('benchmarks/code-assistant.json', 'utf8'));
const cases = full.cases.filter(c => KEEP.includes(c.id));
const subset = {
  id: 'code_assistant_core_v1',
  name: 'RouteBench Code Assistant Core (12)',
  description: '12 highest-signal cases from code-assistant benchmark for cost-efficient paid-model evaluation. Selected from cases that produced failures or score spread on free models.',
  cases
};
fs.writeFileSync('benchmarks/code-assistant-core.json', JSON.stringify(subset, null, 2));
console.log('Generated benchmarks/code-assistant-core.json -', cases.length, 'cases');
cases.forEach(c => console.log(' ', c.metadata.category.padEnd(22), c.id));
if (cases.length !== KEEP.length) console.log('WARN: expected', KEEP.length, 'got', cases.length);
