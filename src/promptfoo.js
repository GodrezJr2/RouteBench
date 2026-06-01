function yamlString(value) {
  return JSON.stringify(value);
}

export function createPromptfooConfig({ baseUrl, apiKeyEnv = 'ROUTEBENCH_API_KEY', models, benchmark }) {
  const providers = models
    .map(
      (model) => `  - id: openai:chat:${model}\n    config:\n      apiBaseUrl: ${baseUrl}\n      apiKeyEnvar: ${apiKeyEnv}\n      temperature: 0`,
    )
    .join('\n');

  const tests = benchmark.cases
    .map((testCase) => {
      const vars = `${testCase.system}\n\n${testCase.prompt}`;
      return [
        '  - description: ' + yamlString(testCase.name),
        '    vars:',
        '      prompt: ' + yamlString(vars),
        '    assert:',
        '      - type: javascript',
        '        value: ' + yamlString('output && output.length > 0'),
      ].join('\n');
    })
    .join('\n');

  return `description: RouteBench Phase 0 Promptfoo export\n\nprompts:\n  - "{{prompt}}"\n\nproviders:\n${providers}\n\ntests:\n${tests}\n`;
}
