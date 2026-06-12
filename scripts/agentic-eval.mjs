import fs from 'node:fs';
import path from 'node:path';
import { createChatClient } from '../src/openaiClient.js';
import { runAgenticBenchmark } from '../src/agentic.js';

// v0 agentic eval runner. Loads broken-repo task fixtures, runs each model
// through the multi-turn fix loop, writes JSON + Markdown report.
//
// Usage:
//   $env:ROUTEBENCH_BASE_URL = "http://192.168.1.7:20128/v1"
//   $env:ROUTEBENCH_API_KEY  = "sk-..."
//   $env:ROUTEBENCH_MODELS   = "oc/north-mini-code-free,kr/claude-sonnet-4.6"
//   node scripts/agentic-eval.mjs

const baseUrl = process.env.ROUTEBENCH_BASE_URL;
const apiKey = process.env.ROUTEBENCH_API_KEY;
const models = (process.env.ROUTEBENCH_MODELS || 'oc/north-mini-code-free,kr/claude-sonnet-4.6')
  .split(',').map((m) => m.trim()).filter(Boolean);
const timeoutMs = Number(process.env.ROUTEBENCH_TIMEOUT_MS || 300000);
const maxTurns = Number(process.env.ROUTEBENCH_MAX_TURNS || 5);

if (!baseUrl || !apiKey) {
  console.error('Set ROUTEBENCH_BASE_URL and ROUTEBENCH_API_KEY.');
  process.exit(1);
}

// ---- Task fixtures --------------------------------------------------------
// cart-repair: subtotal/discount/tax pipeline with four coupled bugs spread
// across two source files. A correct fix must (1) iterate all items, (2) treat
// discount as a percentage, (3) divide tax by 100, and (4) round to 2 decimals
// — and rounding is only discoverable from the failing test, not the source.
const PKG = JSON.stringify({ type: 'module', name: 'cart-fixture', private: true }, null, 2) + '\n';

const TAX_BUGGY = `export function calcTax(amount, taxPct) {
  // BUG: percentage not divided by 100
  return amount * taxPct;
}
`;

const CART_BUGGY = `import { calcTax } from './tax.js';

export function cartTotal(items, discountPct, taxPct) {
  let subtotal = 0;
  // BUG: loop starts at index 1, skipping the first item
  for (let i = 1; i < items.length; i++) {
    subtotal += items[i].price * items[i].qty;
  }
  // BUG: discount subtracted as a flat amount instead of a percentage
  const discounted = subtotal - discountPct;
  const taxed = discounted + calcTax(discounted, taxPct);
  // BUG: no rounding to 2 decimals
  return taxed;
}
`;

const CART_TEST = `import { test } from 'node:test';
import assert from 'node:assert';
import { cartTotal } from '../src/cart.js';

test('subtotal only, no discount, no tax', () => {
  assert.strictEqual(cartTotal([{ price: 10, qty: 2 }], 0, 0), 20);
});

test('percentage discount applied before tax', () => {
  // 100 - 10% = 90, +10% tax = 99
  assert.strictEqual(cartTotal([{ price: 100, qty: 1 }], 10, 10), 99);
});

test('includes every item (no off-by-one)', () => {
  // (50*2 + 25*4)=200, -20% =160, +8% tax =172.8
  assert.strictEqual(cartTotal([{ price: 50, qty: 2 }, { price: 25, qty: 4 }], 20, 8), 172.8);
});

test('rounds to 2 decimals', () => {
  // 0.1 * 3 = 0.30000000000000004 -> 0.3
  assert.strictEqual(cartTotal([{ price: 0.1, qty: 3 }], 0, 0), 0.3);
});

test('empty cart is 0', () => {
  assert.strictEqual(cartTotal([], 10, 10), 0);
});
`;

// schedule-repair: merge-busy + first-free-slot across two files. Four coupled
// bugs: (1) merge does not sort input, (2) merge uses `<` so adjacent intervals
// don't combine, (3) slot finder uses `<` and rejects exact-fit gaps, (4) no
// end-of-day bound so it can return a slot past dayEnd. Harder than cart: edge
// cases (adjacency, exact-fit, no-slot=null) are only visible from the tests.
const INTERVALS_BUGGY = `export function mergeBusy(intervals) {
  const result = [];
  // BUG: input is not sorted by start time
  for (const [s, e] of intervals) {
    const last = result[result.length - 1];
    // BUG: strict < fails to merge adjacent intervals like [9,10],[10,11]
    if (last && s < last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      result.push([s, e]);
    }
  }
  return result;
}
`;

const SCHEDULE_BUGGY = `import { mergeBusy } from './intervals.js';

export function firstFreeSlot(busy, duration, dayStart, dayEnd) {
  const merged = mergeBusy(busy);
  let t = dayStart;
  for (const [s, e] of merged) {
    // BUG: < rejects a gap that fits the duration exactly
    if (t + duration < s) return t;
    t = Math.max(t, e);
  }
  // BUG: no check that the final slot fits before dayEnd
  return t;
}
`;

const SCHEDULE_TEST = `import { test } from 'node:test';
import assert from 'node:assert';
import { mergeBusy } from '../src/intervals.js';
import { firstFreeSlot } from '../src/schedule.js';

test('mergeBusy sorts unsorted input', () => {
  assert.deepStrictEqual(mergeBusy([[600, 660], [540, 600]]), [[540, 660]]);
});

test('mergeBusy merges adjacent intervals', () => {
  assert.deepStrictEqual(mergeBusy([[540, 600], [600, 660]]), [[540, 660]]);
});

test('firstFreeSlot with no busy returns dayStart', () => {
  assert.strictEqual(firstFreeSlot([], 60, 540, 1020), 540);
});

test('firstFreeSlot finds gap before first meeting', () => {
  assert.strictEqual(firstFreeSlot([[600, 660]], 30, 540, 1020), 540);
});

test('firstFreeSlot accepts an exact-fit gap', () => {
  // gap 600-660 is exactly 60 wide
  assert.strictEqual(firstFreeSlot([[540, 600], [660, 1020]], 60, 540, 1020), 600);
});

test('firstFreeSlot returns null when nothing fits before dayEnd', () => {
  assert.strictEqual(firstFreeSlot([[540, 1000]], 60, 540, 1020), null);
});

test('firstFreeSlot accepts a slot that ends exactly at dayEnd', () => {
  assert.strictEqual(firstFreeSlot([[540, 960]], 60, 540, 1020), 960);
});
`;

// lru-repair: an LRU cache over a doubly-linked list + map across two files.
// Three coupled bugs: (1) back() returns the front node so the wrong entry is
// evicted, (2) get() never moves the touched node to the front so recency never
// updates, and (3) both interact — the correct victim is only visible from the
// eviction-order tests. Harder than schedule: the bugs are in pointer/recency
// bookkeeping, not arithmetic.
const LRU_DLL_BUGGY = `export function createList() {
  const head = { key: null, val: null, prev: null, next: null };
  const tail = { key: null, val: null, prev: null, next: null };
  head.next = tail; tail.prev = head;
  return {
    head, tail,
    addFront(node) {
      node.prev = head;
      node.next = head.next;
      head.next.prev = node;
      head.next = node;
    },
    remove(node) {
      node.prev.next = node.next;
      node.next.prev = node.prev;
    },
    // BUG: returns the FRONT (most-recent) node; the LRU victim is at the back
    back() { return this.head.next; },
  };
}
`;

const LRU_CACHE_BUGGY = `import { createList } from './dll.js';

export function createLRU(capacity) {
  const map = new Map();
  const list = createList();
  return {
    get(key) {
      if (!map.has(key)) return -1;
      const node = map.get(key);
      // BUG: does not move the accessed node to the front, so recency never updates
      return node.val;
    },
    put(key, val) {
      if (map.has(key)) {
        const node = map.get(key);
        node.val = val;
        list.remove(node);
        list.addFront(node);
        return;
      }
      const node = { key, val, prev: null, next: null };
      map.set(key, node);
      list.addFront(node);
      if (map.size > capacity) {
        const victim = list.back();
        list.remove(victim);
        map.delete(victim.key);
      }
    },
  };
}
`;

const LRU_TEST = `import { test } from 'node:test';
import assert from 'node:assert';
import { createLRU } from '../src/cache.js';

test('evicts the least-recently-used entry', () => {
  const c = createLRU(2);
  c.put(1, 1); c.put(2, 2);
  assert.strictEqual(c.get(1), 1);   // touch 1 -> 2 is now LRU
  c.put(3, 3);                       // evicts 2
  assert.strictEqual(c.get(2), -1);
  assert.strictEqual(c.get(3), 3);
});

test('get refreshes recency', () => {
  const c = createLRU(2);
  c.put(1, 1); c.put(2, 2);
  c.get(1); c.get(1);
  c.put(3, 3);                       // 2 is LRU -> evicted, 1 survives
  assert.strictEqual(c.get(1), 1);
  assert.strictEqual(c.get(2), -1);
});

test('updating an existing key does not evict and keeps it recent', () => {
  const c = createLRU(2);
  c.put(1, 1); c.put(2, 2);
  c.put(1, 10);                      // update, 1 most-recent
  c.put(3, 3);                       // evicts 2
  assert.strictEqual(c.get(1), 10);
  assert.strictEqual(c.get(2), -1);
  assert.strictEqual(c.get(3), 3);
});
`;

// expr-repair: a recursive-descent arithmetic evaluator split into a tokenizer
// and a parser. Three coupled bugs: (1) the tokenizer reads only one digit so
// multi-digit numbers break, (2) subtraction is implemented as addition, and
// (3) the parser has no parenthesis handling. Each bug is isolated by a
// different test; a correct fix must touch both files.
const EXPR_TOK_BUGGY = `export function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i++; continue; }
    if (ch >= '0' && ch <= '9') {
      // BUG: reads only a single digit, so multi-digit numbers are split
      tokens.push({ type: 'num', value: Number(ch) });
      i++;
    } else {
      tokens.push({ type: 'op', value: ch });
      i++;
    }
  }
  return tokens;
}
`;

const EXPR_EVAL_BUGGY = `import { tokenize } from './tokenize.js';

export function evaluate(expr) {
  const tokens = tokenize(expr);
  let pos = 0;
  function parseExpr() {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos].value === '+' || tokens[pos].value === '-')) {
      const op = tokens[pos++].value;
      const right = parseTerm();
      // BUG: subtraction is added instead of subtracted
      left = left + right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (pos < tokens.length && (tokens[pos].value === '*' || tokens[pos].value === '/')) {
      const op = tokens[pos++].value;
      const right = parseFactor();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parseFactor() {
    const t = tokens[pos++];
    // BUG: no parenthesis handling
    return t.value;
  }
  return parseExpr();
}
`;

const EXPR_TEST = `import { test } from 'node:test';
import assert from 'node:assert';
import { evaluate } from '../src/evaluate.js';

test('operator precedence', () => {
  assert.strictEqual(evaluate('2+3*4'), 14);
  assert.strictEqual(evaluate('2*3+4'), 10);
});

test('multi-digit numbers', () => {
  assert.strictEqual(evaluate('12+34'), 46);
});

test('left-associative subtraction', () => {
  assert.strictEqual(evaluate('10-2-3'), 5);
});

test('parentheses override precedence', () => {
  assert.strictEqual(evaluate('(2+3)*4'), 20);
  assert.strictEqual(evaluate('2*(3+4*2)'), 22);
});
`;

const tasks = [
  {
    id: 'cart_repair_001',
    name: 'Fix subtotal/discount/tax pipeline (2 files, 4 bugs)',
    test_cmd: ['node', '--test'],
    protected_paths: ['test/'],
    files: {
      'package.json': PKG,
      'src/tax.js': TAX_BUGGY,
      'src/cart.js': CART_BUGGY,
      'test/cart.test.js': CART_TEST,
    },
  },
  {
    id: 'schedule_repair_001',
    name: 'Fix merge-busy + first-free-slot scheduler (2 files, 4 edge bugs)',
    test_cmd: ['node', '--test'],
    protected_paths: ['test/'],
    files: {
      'package.json': PKG,
      'src/intervals.js': INTERVALS_BUGGY,
      'src/schedule.js': SCHEDULE_BUGGY,
      'test/schedule.test.js': SCHEDULE_TEST,
    },
  },
  {
    id: 'lru_repair_001',
    name: 'Fix LRU cache eviction + recency (2 files, 3 coupled bugs)',
    test_cmd: ['node', '--test'],
    protected_paths: ['test/'],
    files: {
      'package.json': PKG,
      'src/dll.js': LRU_DLL_BUGGY,
      'src/cache.js': LRU_CACHE_BUGGY,
      'test/lru.test.js': LRU_TEST,
    },
  },
  {
    id: 'expr_repair_001',
    name: 'Fix expression evaluator: tokenizer + precedence + parens (2 files, 3 bugs)',
    test_cmd: ['node', '--test'],
    protected_paths: ['test/'],
    files: {
      'package.json': PKG,
      'src/tokenize.js': EXPR_TOK_BUGGY,
      'src/evaluate.js': EXPR_EVAL_BUGGY,
      'test/expr.test.js': EXPR_TEST,
    },
  },
];

// ---- Run ------------------------------------------------------------------
const callChat = createChatClient({ baseUrl, apiKey, timeoutMs });

console.log(`Agentic eval: ${models.length} model(s) x ${tasks.length} task(s), maxTurns=${maxTurns}`);
const rows = await runAgenticBenchmark({
  tasks,
  models,
  callChat,
  maxTurns,
  onProgress: (done, total, row) => {
    const verdict = row.passed ? `PASS in ${row.turns_used} turn(s)` : `FAIL (${row.status})`;
    console.log(`  [${done}/${total}] ${row.model} :: ${row.task_id} -> ${verdict}  ${row.latency_ms}ms`);
  },
});

// ---- Aggregate + report ---------------------------------------------------
function rankRows(allRows) {
  const byModel = new Map();
  for (const r of allRows) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  }
  const ranked = [];
  for (const [model, rs] of byModel) {
    const solved = rs.filter((r) => r.passed).length;
    const avgScore = Math.round(rs.reduce((s, r) => s + r.score, 0) / rs.length);
    const avgTurns = (rs.filter((r) => r.passed).reduce((s, r) => s + r.turns_used, 0) / (solved || 1));
    const avgLatency = Math.round(rs.reduce((s, r) => s + r.latency_ms, 0) / rs.length);
    const outTokens = rs.reduce((s, r) => s + (r.usage?.completion_tokens || 0), 0);
    ranked.push({ model, solved, total: rs.length, avgScore, avgTurns, avgLatency, outTokens });
  }
  ranked.sort((a, b) => b.solved - a.solved || b.avgScore - a.avgScore || a.avgTurns - b.avgTurns);
  return ranked;
}

const ranked = rankRows(rows);

function renderReport() {
  const lines = [];
  lines.push('# RouteBench Agentic Report (v0)');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Models: ${models.map((m) => '`' + m + '`').join(', ')}`);
  lines.push(`- Tasks: ${tasks.length}  | maxTurns: ${maxTurns}`);
  lines.push('');
  lines.push('Measures multi-turn repo repair: model gets failing tests, edits files, re-runs until green.');
  lines.push('');
  lines.push('## Ranked Models');
  lines.push('');
  lines.push('| Rank | Model | Solved | Avg Score | Avg Turns (solved) | Avg Latency | Out Tokens |');
  lines.push('|---:|---|---:|---:|---:|---:|---:|');
  ranked.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.model} | ${r.solved}/${r.total} | ${r.avgScore} | ${r.avgTurns.toFixed(1)} | ${r.avgLatency}ms | ${r.outTokens} |`);
  });
  lines.push('');
  lines.push('## Per-Task Detail');
  lines.push('');
  lines.push('| Model | Task | Result | Turns | Latency | Out Tokens | Note |');
  lines.push('|---|---|---|---:|---:|---:|---|');
  for (const r of rows) {
    const result = r.passed ? 'PASS' : 'FAIL';
    const note = r.passed ? '' : (r.error_message || r.status).replace(/\|/g, '/').slice(0, 80);
    lines.push(`| ${r.model} | ${r.task_id} | ${result} | ${r.turns_used}/${r.max_turns} | ${r.latency_ms}ms | ${r.usage?.completion_tokens || 0} | ${note} |`);
  }
  lines.push('');
  lines.push('## Turn-by-Turn');
  lines.push('');
  for (const r of rows) {
    lines.push(`### ${r.model} — ${r.task_id} (${r.passed ? 'PASS' : 'FAIL'})`);
    lines.push('');
    for (const h of r.history) {
      if (h.error) {
        lines.push(`- Turn ${h.turn}: provider error — ${h.error}`);
        continue;
      }
      const files = (h.applied_files || []).join(', ') || '(none)';
      lines.push(`- Turn ${h.turn}: edited [${files}] -> ${h.test_passed ? 'tests green' : 'still failing'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

fs.mkdirSync('results', { recursive: true });
fs.writeFileSync('results/agentic-results.json', JSON.stringify({ generated_at: new Date().toISOString(), models, tasks: tasks.map((t) => ({ id: t.id, name: t.name })), rows, ranked }, null, 2));
fs.writeFileSync('results/agentic-report.md', renderReport());
console.log('');
console.log('Saved results/agentic-results.json');
console.log('Saved results/agentic-report.md');
console.log('');
ranked.forEach((r, i) => console.log(`  ${i + 1}. ${r.model}: solved ${r.solved}/${r.total}, avg ${r.avgTurns.toFixed(1)} turns, ${r.avgLatency}ms, ${r.outTokens} out-tokens`));
