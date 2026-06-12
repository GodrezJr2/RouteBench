// Pull the first fenced code block if present, else use the whole output.
// Shared by the deterministic scorers (scoring.js) and the multi-language
// execution scorer (codeExec.js) so both strip model formatting identically.
export function extractCode(output) {
  const fence = output.match(/```(?:[a-zA-Z0-9]+)?\s*\n([\s\S]*?)```/);
  const code = (fence ? fence[1] : output).trim();
  // Strip markdown blockquote prefix ("> " or ">") that some models add before code.
  return code.replace(/^> ?/gm, '').trim();
}
