import Anthropic from '@anthropic-ai/sdk';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';
import { runTests } from './run-tests.js';
import { parsePassingTests, recordPassingTests, TEST_API_PATH } from './test-registry.js';
import { autoFixFailure } from './investigate-fix.js';
import { writeTestAnnotation } from './annotations.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

// Focused prompt — shorter and simpler than the UI test system prompt so the
// local 14B model handles it accurately. API tests are mechanical and repetitive:
// the pattern is always "send request → assert status → assert body".
const API_SYSTEM_PROMPT = `\
You are a Playwright API test engineer for automationexercise.com.

Generate TypeScript test code that calls HTTP endpoints directly using Playwright's
request fixture. No browser, no page objects, no DOM — pure API testing.

## Rules

### Setup
- Import: import { test, expect } from '../../fixtures'
- No page or browser fixtures — only the request fixture
- baseURL: https://automationexercise.com — always use relative paths in request calls

### File and naming
- File: tests/api/<resource>.spec.ts  (e.g. tests/api/products.spec.ts)
- test.describe() = the API resource area ("Products API", "Auth API")
- test() = what the test verifies ("should return 200 with a list of products")

### This site's API response format
Most endpoints return JSON with a responseCode field:
  { responseCode: 200, products: [...] }   — success
  { responseCode: 400, message: "..." }    — error
Assert BOTH the HTTP status code AND the responseCode in the body.

### Assertions (strict order)
1. expect(response.status()).toBe(<expected HTTP status>)
2. const body = await response.json()
3. expect(body.responseCode).toBe(<expected code>)
4. Assert required response fields exist and have correct types

### Error and negative tests
- For unsupported methods, assert status 405 or check the body message
- For missing required parameters, assert status 400 and the body message
- For invalid credentials, assert status 403/401 and the body message

### Output format
Respond with raw JSON only (no markdown fences):
{
  "summary": "one-sentence description of what was generated",
  "files": [
    { "path": "tests/api/resource.spec.ts", "content": "full TypeScript file" }
  ]
}`;

function extractJson(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try { JSON.parse(stripped); return stripped; } catch { /* */ }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  throw new Error('No JSON object found');
}

async function callClaude(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');
}

export async function generateApiTestTool(args: {
  description: string;
  test_name?: string;
  spec_file?: string;
}): Promise<{
  content: { type: 'text'; text: string }[];
  _meta?: { specFile?: string; lastFailureOutput?: string; passing: boolean };
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY environment variable is not set.' }] };
  }

  const localAvailable = await isLocalLlmAvailable();

  const userPrompt = [
    args.test_name ? `Test name hint: ${args.test_name}` : '',
    args.spec_file ? `Write the test to ${args.spec_file}. Create the file if it does not exist; add to it if it does.` : '',
    args.description,
  ].filter(Boolean).join('\n\n');

  // ── Generate — local LLM first, Claude fallback ──────────────────────────
  let generatedBy = 'Claude API';
  let raw: string;

  if (localAvailable) {
    try {
      raw = await callLocalLlm(API_SYSTEM_PROMPT, userPrompt);
      extractJson(raw); // validate — throws if not parseable
      generatedBy = LOCAL_MODEL;
    } catch {
      raw = await callClaude(API_SYSTEM_PROMPT, userPrompt, apiKey);
    }
  } else {
    raw = await callClaude(API_SYSTEM_PROMPT, userPrompt, apiKey);
  }

  let parsed: { summary: string; files: { path: string; content: string }[] };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { content: [{ type: 'text', text: `${generatedBy} returned invalid JSON.\n\n${raw}` }] };
  }

  // ── Write files ───────────────────────────────────────────────────────────
  const written: string[] = [];
  for (const file of parsed.files ?? []) {
    if (!file.path.startsWith('tests/api/')) continue;
    const abs = join(ROOT, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, 'utf-8');
    written.push(file.path);
  }

  const specFile = (parsed.files ?? []).find(
    f => f.path.startsWith('tests/api/') && f.path.endsWith('.spec.ts'),
  );

  // ── Run and record ────────────────────────────────────────────────────────
  let testRunNote = '';
  let passing = true;
  let lastFailureOutput = '';

  if (specFile) {
    const testOutput = await runTests(specFile.path);
    const passed = (testOutput.match(/✓/g) ?? []).length;
    const hasFailed = testOutput.includes('failed') || (testOutput.match(/✗/g) ?? []).length > 0;

    if (passed > 0) await recordPassingTests(parsePassingTests(testOutput), TEST_API_PATH);

    if (passed > 0 && !hasFailed) {
      testRunNote = `✅ ${passed} test${passed === 1 ? '' : 's'} passed — recorded in TEST_API.md`;
    } else {
      passing = false;
      lastFailureOutput = testOutput;
      testRunNote = '⚠️ Initial run failed — attempting auto-fix...\n';
      const fix = await autoFixFailure(testOutput, specFile.path);
      if (fix.verdict === 'app_bug') {
        lastFailureOutput = testOutput;
        await writeTestAnnotation(specFile.path, testOutput, 'app_bug', fix.rootCause, fix.actualBehavior);
        testRunNote += [
          '⚠️  Application bug detected — the test is correct but the API behaves differently.',
          `  What the API does: ${fix.actualBehavior ?? fix.rootCause}`,
          '  The test was NOT modified — annotated in the spec with ⚠️ APP BUG.',
        ].join('\n');
      } else if (fix.fixed) {
        passing = true;
        const fixedPassed = (fix.verifyOutput.match(/✓/g) ?? []).length;
        testRunNote += `✅ Auto-fix applied — ${fixedPassed} test${fixedPassed === 1 ? '' : 's'} now passing — recorded in TEST_API.md`;
        if (fix.lesson) testRunNote += `\n  Lesson learned: ${fix.lesson.rule}`;
      } else {
        lastFailureOutput = fix.verifyOutput || testOutput;
        await writeTestAnnotation(specFile.path, lastFailureOutput, 'broken', fix.rootCause);
        testRunNote += `❌ Could not auto-fix — annotated in the spec with ⚠️ BROKEN\n  Root cause: ${fix.rootCause}`;
      }
    }
  }

  const lines = [
    `✅ ${parsed.summary}`,
    `   Generated by: ${generatedBy}`,
    '',
    '**Files written:**',
    ...written.map(p => `  - ${p}`),
  ];

  if (testRunNote) lines.push('', testRunNote);

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    _meta: specFile ? { specFile: specFile.path, lastFailureOutput, passing } : undefined,
  };
}
