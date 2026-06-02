// LLM-as-judge scorer for open-ended categories (summarization, Indonesian QA)
// where deterministic string matching can't measure answer quality.
//
// The judge is optional: it's only wired in when a judge model is configured
// (ROUTEBENCH_JUDGE_MODEL). The deterministic scorers remain the default so
// runs stay reproducible and free of judge bias unless explicitly opted in.

// Categories that benefit from semantic judging rather than string matching.
export const DEFAULT_JUDGE_CATEGORIES = ['summarization_quality', 'indonesian_qa'];

function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no JSON object in judge output');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('incomplete JSON object in judge output');
}

function clampScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

const JUDGE_SYSTEM =
  'You are a strict evaluation judge. Score the assistant answer for the given ' +
  'task from 0 to 100 based on correctness, completeness, and adherence to the ' +
  'task constraints (including language). Be critical: a wrong or off-topic ' +
  'answer scores low. Respond with ONLY compact JSON and nothing else: ' +
  '{"score": <integer 0-100>, "reason": "<one short sentence>"}.';

function buildJudgePrompt(testCase, output) {
  const refs = testCase.expected?.contains?.length
    ? `Reference points the answer should cover: ${testCase.expected.contains.join('; ')}.`
    : '';
  return [
    'TASK SYSTEM INSTRUCTION:',
    testCase.system ?? '(none)',
    '',
    'TASK:',
    testCase.prompt ?? '(none)',
    refs,
    '',
    'ASSISTANT ANSWER:',
    output,
    '',
    'Return the JSON score now.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// Returns an async judge(testCase, output) -> { score, passed, reason, judge_reason, usage }.
// `client` is the same OpenAI-compatible client used for benchmarking.
export function createJudge({ client, judgeModel }) {
  if (!client || !judgeModel) throw new Error('createJudge requires a client and judgeModel');
  return async function judge(testCase, output) {
    const response = await client({
      model: judgeModel,
      testCase: { system: JUDGE_SYSTEM, prompt: buildJudgePrompt(testCase, output) },
    });
    let parsed;
    try {
      parsed = JSON.parse(extractJsonObject(response.output ?? ''));
    } catch (error) {
      throw new Error(`judge returned unparseable output: ${error.message}`);
    }
    const score = clampScore(parsed.score);
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'judged';
    return {
      score,
      passed: score >= 70,
      reason: `judge: ${reason}`,
      judge_reason: reason,
      usage: response.usage ?? null,
    };
  };
}
