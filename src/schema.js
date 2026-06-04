// Result schema version for benchmark output JSON.
//
// The shape grew well past the original Phase 0 result (p95 latency, per-model
// cost, repeats + run-to-run stddev, confidence, category routing, difficulty
// tiers, diagnosis). Bumping the version makes that explicit. Old `phase0.v1`
// files are still accepted on read so existing results/*.json keep working.
export const RESULT_SCHEMA_VERSION = 'routebench.phase1.v1';

export const SUPPORTED_RESULT_SCHEMAS = new Set([
  'routebench.phase0.v1', // legacy: predates cost / p95 / repeats / diagnosis / difficulty
  'routebench.phase1.v1',
]);

export function isSupportedResultSchema(version) {
  return SUPPORTED_RESULT_SCHEMAS.has(version);
}
