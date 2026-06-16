import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { safeWrite } from '../lib/safe-write.js';
import { TokenBudget } from './budget.js';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';
import { runTests } from './run-tests.js';
import { parsePassingTests, recordPassingTests } from './test-registry.js';
import { tagSpecAfterRecording } from './tag-tests.js';
import { markBacklogEntriesCovered } from './analyze-coverage.js';
import { autoFixFailure } from './investigate-fix.js';
import { writeTestAnnotation } from './annotations.js';
import { extractJson } from './llm-utils.js';
import { formatReqHint } from './requirements-registry.js';
import { errorContent } from '../lib/format-error.js';
import { config, SITE_URL, SITE_HOST, specKind } from '../config.js';

const ROOT = process.cwd();
const MODEL = config.models.primary;

// Site-specific API knowledge lives in mcp-qa.config.json (prompts.*), not in the
// engine — kept out of this prompt so the package stays project-agnostic. Each
// section below is injected into API_SYSTEM_PROMPT only when the project defines it.
const apiNotes = config.prompts?.apiNotes?.trim();
const API_NOTES_SECTION = apiNotes
  ? `### ${SITE_HOST} data shapes — known tricky fields\n${apiNotes}\n\n`
  : '';
const apiResponseFormat = config.prompts?.apiResponseFormat?.trim();
const API_RESPONSE_FORMAT_SECTION = apiResponseFormat ? `${apiResponseFormat}\n\n` : '';
const apiAuthPattern = config.prompts?.apiAuthPattern?.trim();
const API_AUTH_SECTION = apiAuthPattern ? `${apiAuthPattern}\n\n` : '';

// Focused prompt — shorter and simpler than the UI test system prompt so the
// local 14B model handles it accurately. API tests are mechanical and repetitive:
// the pattern is always "send request → assert status → assert body".
export const API_SYSTEM_PROMPT = `\
You are a Playwright API test engineer for ${SITE_HOST}.

Generate TypeScript test code that calls HTTP endpoints directly using Playwright's
request fixture. No browser, no page objects, no DOM — pure API testing.

## Rules

### Setup
- Import: import { test, expect } from '../../fixtures'
- No page or browser fixtures — only the request fixture
- baseURL: ${SITE_URL} — always use relative paths in request calls

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

${API_RESPONSE_FORMAT_SECTION}### Assertions (strict order)
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

${API_NOTES_SECTION}### Asserting message strings — use exact values
When the test description specifies a message string, use toBe() with the exact string,
never toContain() or a paraphrased alternative:
  CORRECT: expect(body.message).toBe('Bad request, email or password parameter is missing in POST request.')
  WRONG:   expect(body.message).toContain('Bad request')
  WRONG:   expect(body.message).toContain('email parameter is missing')
If the description says "Bad request, email or password parameter is missing in POST request."
then assert that exact string — do not split it into alternatives.

${API_AUTH_SECTION}### Test tagging
Tag every generated test so it can be run as part of a targeted subset.
Apply tags at the end of the test name string, in this order: @smoke @critical @req: @negative/@boundary

- @smoke — one primary happy-path test per describe block (e.g. the "should return products list" test)
- @regression — every test gets this tag; marks tests that run on every PR
- @critical — auth and data-mutation endpoints (verifyLogin, createAccount, deleteAccount, updateAccount)

  test('should return products list @smoke @regression', async ({ request }) => { ... });
  test('should verify login with valid credentials @smoke @critical', async ({ request }) => { ... });
  test('should return 400 when email parameter is missing @regression @negative', async ({ request }) => { ... });

Every generated test MUST have at least @regression. Add @smoke only to the primary success test per describe block. Add @critical to auth endpoints and any endpoint that creates, updates, or deletes user data.

If the test description includes a "Requirement hint: tag this test with @req:REQ-NNN",
append @req:REQ-NNN after @smoke/@critical and before @negative/@boundary:
  test('should return products list @smoke @regression @req:REQ-API-001', async ({ request }) => { ... });
Only add @req: when a Requirement hint is explicitly present in the description.

Also classify each test's type by adding at most one of these tags (after @req: if present):
- @negative — the test expects an error responseCode (400/404/405 — bad request, not found, method not allowed)
- @boundary — the test exercises an edge case (empty result list, exact count assertion, min/max parameter values)

Leave both off for ordinary success-path tests — absence means "functional" by default:
  test('should return at least 20 products @regression @boundary', async ({ request }) => { ... });

### Output format
Respond with raw JSON only (no markdown fences):
{
  "summary": "one-sentence description of what was generated",
  "files": [
    { "path": "tests/api/resource.spec.ts", "content": "full TypeScript file" }
  ]
}`;

/**
 * Extract individual test() / test.skip() blocks from generated TypeScript content.
 * Returns the indented source lines of each block, including the comment line above
 * it if one exists (e.g. the [API Tag #N] comment).
 */
function extractTestBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let capturing = false;
  let depth = 0;
  let blockLines: string[] = [];
  let pendingComment: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Capture a leading // comment so it travels with the test block
    if (!capturing && trimmed.startsWith('//')) {
      pendingComment = line;
      continue;
    }

    if (!capturing && /^  test[\s.(]/.test(line)) {
      capturing = true;
      depth = 0;
      blockLines = pendingComment ? [pendingComment] : [];
    }

    pendingComment = null;

    if (capturing) {
      blockLines.push(line);
      for (const ch of line) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      if (depth <= 0 && blockLines.length > 1) {
        blocks.push(blockLines.join('\n').trimEnd());
        blockLines = [];
        capturing = false;
      }
    }
  }
  return blocks;
}

/**
 * Merge new test blocks generated by the LLM into an existing spec file.
 * Skips any block whose test() name already appears in the existing file.
 * Inserts new blocks before the closing '});' of the last describe block.
 * Falls back to writing the full LLM content when the structure can't be parsed.
 */
function mergeTestBlocks(existing: string, generated: string): string {
  const newBlocks = extractTestBlocks(generated);
  if (newBlocks.length === 0) return existing;

  // Filter blocks whose test name already exists in the file
  const unique = newBlocks.filter(block => {
    const nameMatch = block.match(/test\s*\(\s*['"`]([^'"`]+)/);
    if (!nameMatch) return true;
    return !existing.includes(nameMatch[1]);
  });

  if (unique.length === 0) return existing; // nothing new to add

  const insertAt = existing.lastIndexOf('\n});');
  if (insertAt === -1) {
    // Can't find describe closing — fall back to appending whole generated content
    return existing.trimEnd() + '\n\n' + generated.trim() + '\n';
  }

  return (
    existing.slice(0, insertAt) +
    '\n\n' + unique.join('\n\n') +
    existing.slice(insertAt)
  );
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
  /** REQ ID from prd-tests.txt's # req_id field — when set (and not "none"), the generated test is tagged @req:REQ-NNN. */
  req_id?: string;
  budget?: TokenBudget;
  noAutoFix?: boolean;
}): Promise<{
  content: { type: 'text'; text: string }[];
  _meta?: { specFile?: string; lastFailureOutput?: string; passing: boolean };
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorContent('Error: ANTHROPIC_API_KEY environment variable is not set.', { category: 'config', tool: 'generate_api_test' });
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
    formatReqHint(args.req_id),
    args.description,
  ].filter(Boolean).join('\n\n');

  // ── Generate — local LLM first, Claude fallback ──────────────────────────
  // Always try local LLM. When the spec file already exists the model tends to
  // regenerate the whole file — we handle this in the write step by extracting
  // only the new test() blocks and merging them, rather than trusting the model
  // to follow "append only".
  const useLocalLlm = localAvailable;
  let generatedBy = 'Claude API';
  let raw: string;

  if (useLocalLlm) {
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
    return errorContent(`${generatedBy} returned invalid JSON.`, { tool: 'generate_api_test', detail: raw });
  }

  // ── Write files ───────────────────────────────────────────────────────────
  const written: string[] = [];
  for (const file of parsed.files ?? []) {
    if (specKind(file.path) !== 'api') continue;
    const abs = join(ROOT, file.path);

    // When the spec file already has content, merge the new test() blocks from
    // the generated output rather than overwriting — the local model tends to
    // regenerate the whole file instead of appending.
    const onDisk = await readFile(abs, 'utf-8').catch(() => '');
    const finalContent = onDisk ? mergeTestBlocks(onDisk, file.content) : file.content;
    const result = await safeWrite(abs, finalContent + (finalContent.endsWith('\n') ? '' : '\n'));
    if (result.ok) {
      written.push(file.path);
    } else {
      process.stderr.write(`[generate-api-test] skipping update to ${file.path} — ${result.reason}\n`);
    }
  }

  const specFile = (parsed.files ?? []).find(
    f => specKind(f.path) === 'api' && f.path.endsWith('.spec.ts'),
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
      await recordPassingTests(passingTests);
      await tagSpecAfterRecording(specFile.path).catch(() => { /* non-fatal */ });
      const passingNames = passingTests.map(t => { const s = t.title.indexOf(' › '); return s === -1 ? t.title : t.title.substring(s + 3); });
      await markBacklogEntriesCovered(passingNames).catch(() => { /* non-fatal */ });
    }

    if (passed > 0 && !hasFailed) {
      testRunNote = `✅ ${passed} test${passed === 1 ? '' : 's'} passed — recorded in TESTS_API.md`;
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
        } else if (fix.verdict === 'flaky' || fix.verdict === 'transient') {
          passing = true;
          const retryPassed = parsePassingTests(fix.verifyOutput);
          await recordPassingTests(retryPassed);
          await tagSpecAfterRecording(specFile.path).catch(() => { /* non-fatal */ });
          const icon = fix.verdict === 'transient' ? '⚡' : '🌀';
          testRunNote += `${icon} ${fix.rootCause}`;
        } else if (fix.fixed) {
          passing = true;
          const fixedPassed = (fix.verifyOutput.match(/✓/g) ?? []).length;
          await tagSpecAfterRecording(specFile.path).catch(() => { /* non-fatal */ });
          testRunNote += `✅ Auto-fix applied — ${fixedPassed} test${fixedPassed === 1 ? '' : 's'} now passing — recorded in TESTS_API.md`;
          if (fix.lesson) testRunNote += `\n  Lesson learned: ${fix.lesson.rule}`;
        } else {
          lastFailureOutput = fix.verifyOutput || testOutput;
          await writeTestAnnotation(specFile.path, lastFailureOutput, 'broken', fix.rootCause);
          testRunNote += `❌ Could not auto-fix — annotated in the spec with ⚠️ BROKEN\n  Root cause: ${fix.rootCause}`;
        }
        if (fix.blockedWrites.length > 0) {
          testRunNote += '\n⛔ Blocked writes — proposed fix would shrink or drop tests, needs human review:\n'
            + fix.blockedWrites.map(b => `  - ${b.path}: ${b.reason}`).join('\n');
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
