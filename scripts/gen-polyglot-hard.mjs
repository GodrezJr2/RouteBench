import fs from 'node:fs';

// Build the 3-language execution triplet for one problem. Same entry name and
// same JSON test cases across languages — only the system prompt (signature)
// and metadata.language differ. This is what makes per-language profiling
// apples-to-apples: identical problem, measured per language by real execution.
function triplet({ id, entry, jsSig, pySig, javaSig, difficulty, cases, category }) {
  const expected = { entry, cases };
  return [
    {
      id: `${id}_py`, name: `${entry} (Python)`,
      system: `Write only a Python function named ${pySig}. No markdown, no explanation, no test code.`,
      prompt: PROMPTS[id],
      scoring: 'code_exec', expected,
      metadata: { category, difficulty, language: 'python' },
    },
    {
      id: `${id}_java`, name: `${entry} (Java)`,
      system: `Write only a Java class named Solution containing: public static ${javaSig}. No package statement, no markdown, no explanation, no main method.`,
      prompt: PROMPTS[id],
      scoring: 'code_exec', expected,
      metadata: { category, difficulty, language: 'java' },
    },
    {
      id: `${id}_js`, name: `${entry} (JavaScript)`,
      system: `Write only a JavaScript function named ${jsSig}. No markdown, no explanation, no test code.`,
      prompt: PROMPTS[id],
      scoring: 'code_exec', expected,
      metadata: { category, difficulty, language: 'javascript' },
    },
  ];
}

const PROMPTS = {
  trap: 'Given n non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining. Example: [0,1,0,2,1,0,1,3,2,1,2,1] traps 6.',
  coin: 'Given coin denominations and a target amount, return the minimum number of coins needed to make the amount, or -1 if impossible. You may use each denomination unlimited times. Greedy does NOT always work (e.g. coins [1,3,4], amount 6 needs 2 coins, not 3).',
  lvp: 'Given a string of only ( and ) characters, return the length of the longest valid (well-formed) parentheses substring. Example: ")()())" -> 4.',
  kadane: 'Given an integer array, return the largest sum of any contiguous subarray (at least one element). Example: [-2,1,-3,4,-1,2,1,-5,4] -> 6.',
};

const execCases = [
  ...triplet({
    id: 'trap', entry: 'trap', category: 'algo_hard', difficulty: 'hard',
    jsSig: 'trap(height)', pySig: 'trap(height)', javaSig: 'int trap(int[] height)',
    cases: [
      { args: [[0,1,0,2,1,0,1,3,2,1,2,1]], returns: 6 },
      { args: [[4,2,0,3,2,5]], returns: 9 },
      { args: [[]], returns: 0 },
      { args: [[1,2,3]], returns: 0 },
      { args: [[3,2,1]], returns: 0 },
      { args: [[5]], returns: 0 },
    ],
  }),
  ...triplet({
    id: 'coin', entry: 'coinChange', category: 'algo_hard', difficulty: 'hard',
    jsSig: 'coinChange(coins, amount)', pySig: 'coinChange(coins, amount)', javaSig: 'int coinChange(int[] coins, int amount)',
    cases: [
      { args: [[1,2,5], 11], returns: 3 },
      { args: [[2], 3], returns: -1 },
      { args: [[1,3,4], 6], returns: 2 },
      { args: [[1,5,11], 15], returns: 3 },
      { args: [[1], 0], returns: 0 },
    ],
  }),
  ...triplet({
    id: 'lvp', entry: 'longestValidParentheses', category: 'algo_hard', difficulty: 'hard',
    jsSig: 'longestValidParentheses(s)', pySig: 'longestValidParentheses(s)', javaSig: 'int longestValidParentheses(String s)',
    cases: [
      { args: ['(()'], returns: 2 },
      { args: [')()())'], returns: 4 },
      { args: [''], returns: 0 },
      { args: ['()(()'], returns: 2 },
      { args: ['()(())'], returns: 6 },
    ],
  }),
  ...triplet({
    id: 'kadane', entry: 'maxSubArray', category: 'algo_medium', difficulty: 'medium',
    jsSig: 'maxSubArray(nums)', pySig: 'maxSubArray(nums)', javaSig: 'int maxSubArray(int[] nums)',
    cases: [
      { args: [[-2,1,-3,4,-1,2,1,-5,4]], returns: 6 },
      { args: [[1]], returns: 1 },
      { args: [[-1,-2,-3]], returns: -1 },
      { args: [[5,4,-1,7,8]], returns: 23 },
    ],
  }),
];

// Security / CWE detection — language-agnostic reasoning (no language tag so the
// per-language axis stays a pure code-writing signal). Snippet language noted in
// the case name only.
const SEC = [
  {
    id: 'cwe_sqli_php', name: 'CWE-89 SQL injection (PHP)',
    system: 'You are a security auditor. Name the specific vulnerability class in this code.',
    prompt: 'What is the vulnerability?\n\n$id = $_GET["id"];\n$result = mysqli_query($conn, "SELECT * FROM users WHERE id = " . $id);',
    scoring: 'contains', expected: { contains: ['injection'], not_contains: ['no vulnerability', 'is secure', 'is safe'] },
    metadata: { category: 'security_cwe', difficulty: 'medium' },
  },
  {
    id: 'cwe_cmdi_py', name: 'CWE-78 command injection (Python)',
    system: 'You are a security auditor. Name the specific vulnerability class in this code.',
    prompt: 'What is the vulnerability?\n\nimport os\nfilename = request.args.get("file")\nos.system("cat " + filename)',
    scoring: 'contains', expected: { contains: ['command injection'], not_contains: ['no vulnerability', 'is secure', 'is safe'] },
    metadata: { category: 'security_cwe', difficulty: 'medium' },
  },
  {
    id: 'cwe_xxe_java', name: 'CWE-611 XXE (Java)',
    system: 'You are a security auditor. Name the specific vulnerability class (acronym ok).',
    prompt: 'What is the vulnerability?\n\nDocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();\n// external entity processing left enabled\nDocument doc = dbf.newDocumentBuilder().parse(userSuppliedXml);',
    scoring: 'contains', expected: { contains: ['xxe'], not_contains: ['no vulnerability', 'is secure', 'is safe'] },
    metadata: { category: 'security_cwe', difficulty: 'hard' },
  },
  {
    id: 'cwe_deser_py', name: 'CWE-502 insecure deserialization (Python)',
    system: 'You are a security auditor. Name the specific vulnerability class in this code.',
    prompt: 'What is the vulnerability?\n\nimport pickle\ndata = request.get_data()\nobj = pickle.loads(data)  # data from untrusted client',
    scoring: 'contains', expected: { contains: ['deserial'], not_contains: ['no vulnerability', 'is secure', 'is safe'] },
    metadata: { category: 'security_cwe', difficulty: 'hard' },
  },
  {
    id: 'cwe_path_node', name: 'CWE-22 path traversal (Node)',
    system: 'You are a security auditor. Name the specific vulnerability class in this code.',
    prompt: 'What is the vulnerability?\n\nconst file = req.query.name;\nfs.readFile("/var/data/" + file, (e, d) => res.send(d));',
    scoring: 'contains', expected: { contains: ['traversal'], not_contains: ['no vulnerability', 'is secure', 'is safe'] },
    metadata: { category: 'security_cwe', difficulty: 'medium' },
  },
  {
    id: 'cwe_weakhash', name: 'CWE-327 weak password hash (Python)',
    system: 'You are a security auditor. Identify what is cryptographically wrong here.',
    prompt: 'What is wrong with this password hashing?\n\nimport hashlib\nhashed = hashlib.md5(password.encode()).hexdigest()',
    scoring: 'contains', expected: { contains: ['md5'], not_contains: ['no problem', 'is fine'] },
    metadata: { category: 'security_cwe', difficulty: 'medium' },
  },
];

const benchmark = {
  id: 'polyglot_hard_v1',
  name: 'RouteBench Polyglot Hard v1',
  description: '18-case hard pack for per-language profiling + security. 12 execution cases (4 hard algorithms x Python/Java/JavaScript, run for REAL via code_exec) tagged by language for the Per-Language Breakdown, plus 6 CWE/security detection cases (language-agnostic reasoning). Reveals where a model is strong vs weak per language and on security.',
  cases: [...execCases, ...SEC],
};

fs.writeFileSync('benchmarks/polyglot-hard.json', JSON.stringify(benchmark, null, 2));
console.log('Generated benchmarks/polyglot-hard.json -', benchmark.cases.length, 'cases');
const byLang = {};
for (const c of benchmark.cases) {
  const k = c.metadata.language || `(reasoning:${c.metadata.category})`;
  byLang[k] = (byLang[k] || 0) + 1;
}
console.log(byLang);
