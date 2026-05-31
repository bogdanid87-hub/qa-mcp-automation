import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { TokenBudget } from './budget.js';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';
import { runTests } from './run-tests.js';
import { parsePassingTests, recordPassingTests, TESTS_API_PATH } from './test-registry.js';
import { tagSpecAfterRecording } from './tag-tests.js';
import { markBacklogEntriesCovered } from './analyze-coverage.js';
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

### File structure — always follow this pattern
Every spec file must have three sections at the top before any test.describe():

1. Endpoint constants — one named const per endpoint used in the file:
   const PRODUCTS_ENDPOINT = '/api/productsList';
   const BRANDS_ENDPOINT   = '/api/brandsList';

2. A shared parseApiResponse helper — import APIResponse from Playwright and use it
   as the parameter type (NOT typeof fetch, which is the browser API, NOT Playwright):
   import type { APIResponse } from '@playwright/test';
   async function parseApiResponse(response: APIResponse): Promise<any> {
     expect(response.status()).toBe(200);
     return response.json();
   }

3. test.describe() with all tests inside.

Tests then use the helper:
   test('should return products', async ({ request }) => {
     const body = await parseApiResponse(await request.get(PRODUCTS_ENDPOINT));
     expect(body.responseCode).toBe(200);
     expect(Array.isArray(body.products)).toBe(true);
   });

Never repeat expect(response.status()).toBe(200) inside individual tests — the
helper already asserts it.

### File and naming
- File: tests/api/<resource>.spec.ts  (e.g. tests/api/products.spec.ts)
- test.describe() = the API resource area ("Products API", "Auth API")
- test() = what the test verifies ("should return products list")

### This site's API response format — READ CAREFULLY
ALL HTTP responses from this API return status 200 at the transport level, even for
errors. NEVER assert response.status() for anything other than 200.
The actual result code is always inside the JSON body as "responseCode":

  HTTP 200 + { responseCode: 200, products: [...] }      ← success
  HTTP 200 + { responseCode: 405, message: "..." }       ← method not allowed
  HTTP 200 + { responseCode: 400, message: "..." }       ← bad request / missing param
  HTTP 200 + { responseCode: 404, message: "..." }       ← not found
  HTTP 200 + { responseCode: 201, message: "User created!" } ← createAccount success

CORRECT assertions (always write this pattern):
  expect(response.status()).toBe(200);      // HTTP transport is always 200
  expect(body.responseCode).toBe(405);     // check the actual result in the body

WRONG assertions (never write these):
  expect(response.status()).toBe(405);     // ✗ HTTP is always 200, never 405
  expect(response.status()).toBe(400);     // ✗ HTTP is always 200, never 400
  expect(response.status()).toBe(201);     // ✗ even createAccount returns HTTP 200

### Assertions (strict order)
1. expect(response.status()).toBe(200);          // always 200 — never anything else
2. const body = await response.json();
3. expect(body.responseCode).toBe(<expected code>);
4. Assert required response fields exist and have correct types

### Error and negative tests
- For unsupported methods: expect(body.responseCode).toBe(405) and check body.message
- For missing required parameters: expect(body.responseCode).toBe(400) and check body.message
- For invalid credentials: expect(body.responseCode).toBe(404) and check body.message

### OR assertions — never use || between expect() calls
expect() returns void, not boolean. To assert "A or B", use a boolean expression:
  CORRECT: expect(a.includes('top') || b.includes('top')).toBe(true);
  WRONG:   expect(a).toContain('top') || expect(b).toContain('top');  // TS error: void || void

### automationexercise.com data shapes — known tricky fields
- product.category is a NESTED OBJECT: { usertype: { usertype: "Women" }, category: "Tops" }
  Never call .toLowerCase() directly on it. To read the category string: product.category.category
- Duplicate email registration returns responseCode 400, message: "Email already exists!" (with the s)
- getUserDetailByEmail response uses field name birth_day (not birth_date)

### Asserting message strings — use exact values
When the test description specifies a message string, use toBe() with the exact string,
never toContain() or a paraphrased alternative:
  CORRECT: expect(body.message).toBe('Bad request, email or password parameter is missing in POST request.')
  WRONG:   expect(body.message).toContain('Bad request')
  WRONG:   expect(body.message).toContain('email parameter is missing')
If the description says "Bad request, email or password parameter is missing in POST request."
then assert that exact string — do not split it into alternatives.

### Tests that require valid credentials — MANDATORY PATTERN
Any test that calls /api/verifyLogin or other auth endpoints expecting a SUCCESS response
(body.responseCode 200) MUST create a real test account in test.beforeAll and delete it
in test.afterAll. NEVER invent or hardcode credentials — they will not exist on the live site.

Required fields for POST /api/createAccount (all mandatory):
  name, email, password, title, birth_date, birth_month, birth_year,
  firstname, lastname, company, address1, address2, country, zipcode, state, city, mobile_number

Template to follow whenever valid credentials are needed:

const testEmail = \`api_test_\${Date.now()}@example.com\`;
const testPassword = 'TestPass123';

test.describe('Auth API', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/createAccount', { form: {
      name: 'API Test User', email: testEmail, password: testPassword,
      title: 'Mr', birth_date: '1', birth_month: '1', birth_year: '2000',
      firstname: 'API', lastname: 'Test', company: 'QA Co',
      address1: '123 Main St', address2: '', country: 'United States',
      zipcode: '10001', state: 'New York', city: 'New York',
      mobile_number: '5551234567'
    }});
  });

  test.afterAll(async ({ request }) => {
    await request.delete('/api/deleteAccount', {
      form: { email: testEmail, password: testPassword }
    });
  });
});

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
  budget?: TokenBudget;
  noAutoFix?: boolean;
}): Promise<{
  content: { type: 'text'; text: string }[];
  _meta?: { specFile?: string; lastFailureOutput?: string; passing: boolean };
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY environment variable is not set.' }] };
  }

  const localAvailable = await isLocalLlmAvailable();

  // Read existing spec file so the AI can append rather than overwrite
  let existingContent = '';
  if (args.spec_file) {
    try {
      existingContent = await readFile(join(ROOT, args.spec_file), 'utf-8');
    } catch { /* new file */ }
  }

  const specInstruction = args.spec_file
    ? existingContent
      ? `Add the new test to ${args.spec_file}. Current file content shown below — do NOT remove or modify existing tests, only add the new one:\n\`\`\`typescript\n${existingContent}\n\`\`\``
      : `Create ${args.spec_file} with this test.`
    : '';

  const userPrompt = [
    args.test_name ? `Test name hint: ${args.test_name}` : '',
    specInstruction,
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

    if (passed > 0) {
      const passingTests = parsePassingTests(testOutput);
      await recordPassingTests(passingTests, TESTS_API_PATH);
      await tagSpecAfterRecording(specFile.path).catch(() => { /* non-fatal */ });
      const passingNames = passingTests.map(t => { const s = t.title.indexOf(' › '); return s === -1 ? t.title : t.title.substring(s + 3); });
      await markBacklogEntriesCovered(passingNames).catch(() => { /* non-fatal */ });
    }

    if (passed > 0 && !hasFailed) {
      testRunNote = `✅ ${passed} test${passed === 1 ? '' : 's'} passed — recorded in TEST_API.md`;
    } else {
      passing = false;
      lastFailureOutput = testOutput;

      if (args.noAutoFix) {
        // Batch mode — annotate as BROKEN immediately, let user run npm run fix manually
        await writeTestAnnotation(specFile.path, lastFailureOutput, 'broken',
          'Failed on first run — run `npm run fix` to investigate');
        testRunNote = '❌ Test failed — annotated as BROKEN (auto-fix skipped in batch mode). Run `npm run fix` to investigate.';
      } else {
        testRunNote = '⚠️ Initial run failed — attempting auto-fix...\n';
        const fix = await autoFixFailure(testOutput, specFile.path, args.budget);
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
