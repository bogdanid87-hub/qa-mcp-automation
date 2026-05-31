import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { getSystemBlocks, appendLearnedRule } from '../prompts/system.js';
import { readFocusedContextForFailure } from './list-resources.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { runTests, runTestsTool } from './run-tests.js';
import { parsePassingTests, recordPassingTests, registryForSpec } from './test-registry.js';
import { TokenBudget } from './budget.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

// ── Screenshot helpers ─────────────────────────────────────────────────────────

/**
 * Parse screenshot paths out of Playwright failure output.
 * Playwright prints: "attachment #N: screenshot (image/png) ───\n  test-results/..."
 */
function findFailureScreenshots(output: string): string[] {
  const paths: string[] = [];
  const re = /attachment #\d+: screenshot \(image\/png\)[^\n]*\n\s*(test-results\/[^\n]+\.png)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    paths.push(join(ROOT, m[1].trim()));
  }
  return paths;
}

async function readScreenshotAsBase64(absPath: string): Promise<string | null> {
  try {
    const buf = await readFile(absPath);
    return buf.toString('base64');
  } catch {
    return null;
  }
}

// ── DOM inspection helpers ─────────────────────────────────────────────────────

/** True when the failure looks like a locator/element timeout — not an import or type error. */
function isLocatorFailure(output: string): boolean {
  return /locator\.\w+:.*timeout|waiting for locator\(|element\(s\) not found|toBeVisible.*failed/i.test(output);
}

/** Extract the spec file path from Playwright failure output. */
function extractSpecPath(output: string): string | null {
  const m = output.match(/›\s+(tests\/[^\s:]+\.spec\.ts)/);
  return m ? m[1] : null;
}

/**
 * Read a spec file and return every unique URL path used in page.goto() or
 * BasePage.navigate() calls, capped at 4 to keep context manageable.
 */
async function extractUrlsFromSpec(specPath: string): Promise<string[]> {
  try {
    const src = await readFile(join(ROOT, specPath), 'utf-8');
    const urls = new Set<string>();
    const re = /(?:page\.goto|this\.navigate|\.navigate)\s*\(\s*['"`](\/[^'"`\s,)]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) urls.add(m[1]);
    return [...urls].slice(0, 4);
  } catch {
    return [];
  }
}

interface InvestigateResponse {
  verdict: 'code_bug' | 'app_bug' | 'unclear';
  root_cause: string;
  actual_behavior?: string;
  files: { path: string; content: string }[];
  lesson: {
    problem_class: string;
    rule: string;
  } | null;
}

export interface AutoFixResult {
  fixed: boolean;
  verdict: 'code_bug' | 'app_bug' | 'unclear';
  rootCause: string;
  /** Only present when verdict is 'app_bug' — describes what the app actually does. */
  actualBehavior?: string;
  fixedFiles: string[];
  lesson: { problemClass: string; rule: string } | null;
  verifyOutput: string;
  budgetExceeded: boolean;
}

/**
 * Core fix cycle: call Claude to diagnose a failure, write corrections, save the
 * lesson, re-run the spec, and record any newly passing tests.
 *
 * Exported so generate-test and CLI fix loops can call it directly.
 * Pass a TokenBudget to track cumulative cost across multiple attempts.
 */
export async function autoFixFailure(
  failureOutput: string,
  pattern?: string,
  budget?: TokenBudget,
): Promise<AutoFixResult> {
  if (budget?.exceeded) {
    return { fixed: false, verdict: 'unclear', rootCause: '', fixedFiles: [], lesson: null, verifyOutput: '', budgetExceeded: true };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const existingContext = await readFocusedContextForFailure(failureOutput);
  const client = new Anthropic({ apiKey });

  // ── Screenshot collection ──────────────────────────────────────────────────
  const screenshotPaths = findFailureScreenshots(failureOutput);
  const screenshotBlocks: Anthropic.ImageBlockParam[] = (
    await Promise.all(screenshotPaths.slice(0, 2).map(readScreenshotAsBase64))
  )
    .filter((d): d is string => d !== null)
    .map((data) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data } }));

  // ── DOM inspection for locator failures ───────────────────────────────────
  let domContext = '';
  if (isLocatorFailure(failureOutput)) {
    const specPath = extractSpecPath(failureOutput);
    const urls = specPath ? await extractUrlsFromSpec(specPath) : [];
    if (urls.length > 0) {
      try {
        const snapshots = await inspectPages(urls);
        domContext = formatSnapshots(snapshots);
      } catch { /* proceed without DOM snapshot */ }
    }
  }

  const TASK_PROMPT = `\
First, decide what kind of failure this is:

**"code_bug"** — the test logic is mechanically wrong: bad locator, wrong selector, missing wait,
  incorrect import, timing issue, wrong URL, etc. The test's intended assertion is correct but the
  code doesn't implement it properly. → Fix the code.

**"app_bug"** — the test logic is correct and is asserting the right thing, but the application
  under test behaves differently from what is expected. Example: a negative test asserts that
  duplicate emails are rejected, but the site accepts them anyway.
  → Do NOT change the test. Do NOT alter its assertions or purpose. Return "files": [].
  → Describe what the application actually does in "actual_behavior".

**"unclear"** — not enough information to decide with confidence.

⚠️  CRITICAL: Never change a test's assertions or purpose to make it pass. A test that
documents an application bug is correct and valuable — it proves the bug exists. Only fix
mechanical code errors, never semantic intent.

Respond with raw JSON only (no markdown fences):
{
  "verdict": "code_bug" | "app_bug" | "unclear",
  "root_cause": "concise explanation of why the test is failing",
  "actual_behavior": "what the application actually does (required when verdict is app_bug, omit otherwise)",
  "files": [
    { "path": "relative/path/to/file.ts", "content": "full corrected file content" }
  ],
  "lesson": {
    "problem_class": "Short description of the general problem class (1 sentence)",
    "rule": "The actionable rule to prevent it (1-2 sentences)"
  }
}

If verdict is "app_bug", set "files" to [] and "lesson" to null.
If no files need changing for a code_bug, return an empty array for "files".
If the failure is not reproducible or the cause is unclear, set "lesson" to null.
`;

  const domSection = domContext
    ? `## Live DOM snapshot (real elements on the failing page — use these for correct locators)\n\n${domContext}\n\n---\n\n`
    : '';

  const screenshotNote = screenshotBlocks.length > 0
    ? `\n\n(${screenshotBlocks.length} screenshot${screenshotBlocks.length > 1 ? 's' : ''} of the page at point of failure attached below)`
    : '';

  const userBlocks: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `## Current codebase\n\n${existingContext}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `${domSection}## Failing test output${screenshotNote}\n\n\`\`\`\n${failureOutput}\n\`\`\`\n\n---\n\n## Your task\n\n${TASK_PROMPT}`,
    },
    ...screenshotBlocks,
  ];

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: await getSystemBlocks(),
      messages: [{ role: 'user', content: userBlocks }],
    });
    budget?.add(
      message.usage.input_tokens,
      message.usage.output_tokens,
      message.usage.cache_creation_input_tokens ?? 0,
      message.usage.cache_read_input_tokens ?? 0,
    );
    raw = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch (err: any) {
    return { fixed: false, verdict: 'unclear', rootCause: `Claude API error: ${err.message}`, fixedFiles: [], lesson: null, verifyOutput: '', budgetExceeded: false };
  }

  let parsed: InvestigateResponse;
  try {
    const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    let jsonStr = stripped;
    try { JSON.parse(stripped); } catch {
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start !== -1 && end > start) jsonStr = stripped.slice(start, end + 1);
    }
    parsed = JSON.parse(jsonStr);
  } catch {
    return { fixed: false, verdict: 'unclear', rootCause: 'Claude returned invalid JSON', fixedFiles: [], lesson: null, verifyOutput: '', budgetExceeded: false };
  }

  const verdict = parsed.verdict ?? 'unclear';

  // App bug — the test is correct; the application is broken. Never touch the test files.
  if (verdict === 'app_bug') {
    return {
      fixed: false,
      verdict: 'app_bug',
      rootCause: parsed.root_cause,
      actualBehavior: parsed.actual_behavior,
      fixedFiles: [],
      lesson: null,
      verifyOutput: '',
      budgetExceeded: false,
    };
  }

  // Code bug or unclear — attempt to fix the test code
  const fixedFiles: string[] = [];
  for (const file of parsed.files ?? []) {
    const abs = join(ROOT, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, 'utf-8');
    fixedFiles.push(file.path);
  }

  // Persist lesson
  const lesson = parsed.lesson
    ? { problemClass: parsed.lesson.problem_class, rule: parsed.lesson.rule }
    : null;
  if (lesson) await appendLearnedRule({ problemClass: lesson.problemClass, rule: lesson.rule });

  // Re-run to verify, then record passing tests
  let verifyOutput = '';
  if (fixedFiles.length > 0) {
    verifyOutput = await runTests(pattern);
    const registry = pattern ? registryForSpec(pattern) : undefined;
    await recordPassingTests(parsePassingTests(verifyOutput), registry);
  }

  const failed = verifyOutput.includes('failed') || verifyOutput.includes('Error');
  const fixed = fixedFiles.length > 0 && !failed;

  return { fixed, verdict, rootCause: parsed.root_cause, fixedFiles, lesson, verifyOutput, budgetExceeded: budget?.exceeded ?? false };
}

export async function investigateFixTool(args: {
  test_output?: string;
  pattern?: string;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY is not set.' }],
    };
  }

  // Get the failure output (run tests if not provided)
  let failureOutput = args.test_output ?? '';
  if (!failureOutput) {
    const result = await runTestsTool({ pattern: args.pattern });
    failureOutput = result.content[0]?.text ?? '';
  }

  if (!failureOutput.includes('failed') && !failureOutput.includes('Error')) {
    return {
      content: [{ type: 'text', text: 'No failures detected in test output:\n\n' + failureOutput }],
    };
  }

  const { verdict, rootCause, actualBehavior, fixedFiles, lesson } = await autoFixFailure(failureOutput, args.pattern);

  const lines: string[] = [`## Verdict\n${verdict === 'app_bug' ? '⚠️  Application bug' : verdict === 'code_bug' ? '🔧 Code bug' : '❓ Unclear'}`, `\n## Root cause\n${rootCause}`];

  if (verdict === 'app_bug') {
    lines.push(
      '\n## Actual application behaviour',
      actualBehavior ?? '(not described)',
      '\n⚠️  The test was NOT modified — it correctly documents a bug in the application under test.',
    );
  } else if (fixedFiles.length) {
    lines.push('\n## Fixed files', ...fixedFiles.map((p) => `  - ${p}`));
  } else {
    lines.push('\n## Fixed files\n  (none — no code changes needed)');
  }

  if (lesson) {
    lines.push(
      '\n## Lesson learned (added to rules)',
      `**Problem class**: ${lesson.problemClass}`,
      `**Rule**: ${lesson.rule}`,
    );
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
