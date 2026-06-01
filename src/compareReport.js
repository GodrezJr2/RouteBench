function signedNum(value, suffix = '') {
  if (value == null) return 'N/A';
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}${suffix}`;
}

function pct(rate) {
  return `${Math.round(rate * 100)}%`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

export function renderCompareReport(compare, { baselinePath = '', candidatePath = '' } = {}) {
  const lines = [];
  lines.push('# RouteBench Compare Report', '');
  lines.push(`- Baseline: ${baselinePath || '(baseline)'} (started: ${compare.baseline.started_at})`);
  lines.push(`- Candidate: ${candidatePath || '(candidate)'} (started: ${compare.candidate.started_at})`);
  lines.push(`- Generated: ${compare.generated_at}`, '');

  const { summary } = compare;
  lines.push('## Summary', '');
  lines.push(
    `- ${summary.total_regressions} regression(s), ${summary.total_improvements} improvement(s)`,
  );
  lines.push(
    `- ${summary.new_failure_count} new failure(s), ${summary.recovered_count} recovered`,
  );
  lines.push('');

  const rc = compare.recommendation_change;
  lines.push('## Recommendation Change', '');
  if (rc.primary_changed) {
    lines.push(
      `**Primary model CHANGED:** \`${rc.baseline_primary}\` → \`${rc.candidate_primary}\``,
    );
  } else {
    lines.push(`Primary model unchanged: \`${rc.baseline_primary}\``);
  }
  const bFalls = rc.baseline_fallbacks.map((m) => `\`${m}\``).join(' → ') || 'none';
  const cFalls = rc.candidate_fallbacks.map((m) => `\`${m}\``).join(' → ') || 'none';
  if (rc.fallback_changed) {
    lines.push('**Fallback chain CHANGED:**');
    lines.push(`- Baseline: ${bFalls}`);
    lines.push(`- Candidate: ${cFalls}`);
  } else {
    lines.push(`Fallback chain unchanged: ${bFalls}`);
  }
  lines.push('');

  lines.push('## Model Changes', '');
  lines.push('| Model | Baseline Score | Candidate Score | Score Δ | Latency Δ | Error Rate Δ |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const mc of compare.model_comparisons) {
    const bScore = mc.baseline ? mc.baseline.overall_score : '–';
    const cScore = mc.candidate ? mc.candidate.overall_score : '–';
    const presence = !mc.in_baseline ? '(new)' : !mc.in_candidate ? '(removed)' : '';
    const label = presence ? `${escapeCell(mc.model)} ${presence}` : escapeCell(mc.model);
    lines.push(
      `| ${label} | ${bScore} | ${cScore} | ${signedNum(mc.score_delta)} | ${signedNum(mc.latency_delta_ms, 'ms')} | ${mc.error_rate_delta != null ? signedNum(mc.error_rate_delta * 100, '%') : 'N/A'} |`,
    );
  }
  lines.push('');

  const catRows = compare.model_comparisons.flatMap((mc) =>
    mc.category_changes
      .filter((c) => c.delta !== 0 && c.delta != null)
      .map((c) => ({ model: mc.model, ...c })),
  );
  if (catRows.length > 0) {
    lines.push('## Category Changes', '');
    lines.push('| Model | Category | Baseline | Candidate | Δ |');
    lines.push('|---|---|---:|---:|---:|');
    for (const row of catRows) {
      lines.push(
        `| ${escapeCell(row.model)} | ${escapeCell(row.category)} | ${row.baseline_score ?? '–'} | ${row.candidate_score ?? '–'} | ${signedNum(row.delta)} |`,
      );
    }
    lines.push('');
  }

  const caseRows = compare.model_comparisons.flatMap((mc) => [
    ...mc.new_failures.map((id) => ({ model: mc.model, case_id: id, change: 'NEW FAILURE' })),
    ...mc.recovered.map((id) => ({ model: mc.model, case_id: id, change: 'RECOVERED' })),
    ...mc.status_changes.map((sc) => ({
      model: mc.model,
      case_id: sc.case_id,
      change: `${sc.baseline_status} → ${sc.candidate_status}`,
    })),
  ]);
  if (caseRows.length > 0) {
    lines.push('## Case Status Changes', '');
    lines.push('| Model | Case | Change |');
    lines.push('|---|---|---|');
    for (const row of caseRows) {
      lines.push(`| ${escapeCell(row.model)} | ${escapeCell(row.case_id)} | ${row.change} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
