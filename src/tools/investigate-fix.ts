import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getSystemBlocks, appendLearnedRule } from '../prompts/system.js';
import { safeWrite, unifiedDiff } from '../lib/safe-write.js';
import { readFocusedContextForFailure } from './list-resources.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { runTests, runTestsTool } from './run-tests.js';
import { parsePassingTests, recordPassingTests, parseFailingTestsFromOutput } from './test-registry.js';
import { markBacklogEntriesCovered } from './analyze-coverage.js';
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

/** True when the failure looks like a connectivity or navigation error — app was unreachable. */
function isInfraFailure(output: string): boolean {
  return /net::ERR_|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_ABORTED|Navigation failed|Failed to navigate|browser has been closed|Target closed|502|503/i.test(output);
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

// ── Loop helpers ─────────────────────────────────────────────────────────────

/** Strip ANSI colour codes, durations, and generated-artifact paths so cosmetic
 *  differences between runs (timings, screenshot filenames) don't change the signature. */
function normalizeForSignature(line: string): string {
  return line
    .replace(/\x1B\[[0-9;]*m/g, '')
    .replace(/\d+(\.\d+)?\s*m?s\b/g, '<dur>')
    .replace(/test-results\/\S+/g, '<artifact>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a stable signature for a Playwright failure-output string, used by the
 * fix loop's no-progress detector: if a fix attempt's verification run produces
 * the same signature as the failure that triggered it, the fix had no effect and
 * the loop stops rather than repeating it.
 *
 * Combines the sorted set of failing `spec::name` keys with the normalized
 * "Error:"/"Locator:"/"Expected:"/"Received:" diagnostic lines — only a genuine
 * change in what is failing or how counts as progress.
 */
export function failureSignature(output: string): string {
  const failing = parseFailingTestsFromOutput(output).map(f => `${f.spec}::${f.name}`).sort();

  const detailRe = /^\s*(Error|TimeoutError|AssertionError|Locator|Expected|Received):.*$/gm;
  const details = [...output.matchAll(detailRe)].map(m => normalizeForSignature(m[0])).sort();

  return [...failing, ...details].join('\n');
}

// ── Intent-signature helpers ────────────────────────────────────────────────
//
// "Objective preservation": a fix may change HOW a test reaches an assertion
// (locators, waits, navigation) but never WHAT it asserts. We capture, per
// test() title, the sorted list of "assertion chains" — everything chained
// after expect(...) such as ".toBe(5)" or ".not.toBeVisible()" — while
// deliberately excluding the expect() subject itself (the locator/value,
// which is the "how"). If a proposed fix changes this signature for a test
// that exists in both the old and new content, the write is blocked.

/**
 * Find the index of the bracket matching the opening bracket at `openIdx`
 * (one of '(', '{', '['), skipping over string/template literal contents.
 * Returns -1 if unmatched.
 */
function findMatchingBracket(content: string, openIdx: number): number {
  const open = content[openIdx];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { inString = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Return the index of the first non-whitespace character at or after `idx`. */
function skipWhitespace(content: string, idx: number): number {
  while (idx < content.length && /\s/.test(content[idx])) idx++;
  return idx;
}

/**
 * Extract the sorted list of assertion chains in `body` — for each
 * expect(...) call, everything chained afterwards (e.g. ".toBe(5)",
 * ".not.toBeVisible()", ".toHaveText('foo')"), with whitespace collapsed.
 */
function extractExpectChains(body: string): string[] {
  const chains: string[] = [];
  const expectRe = /\bexpect(?:\.\w+)?\s*\(/g;
  while (expectRe.exec(body) !== null) {
    const openIdx = expectRe.lastIndex - 1;
    const closeIdx = findMatchingBracket(body, openIdx);
    if (closeIdx === -1) break;

    let i = closeIdx + 1;
    while (true) {
      const next = skipWhitespace(body, i);
      if (body[next] !== '.') break;
      const callMatch = /^\.\w+/.exec(body.slice(next));
      if (!callMatch) break;
      let j = skipWhitespace(body, next + callMatch[0].length);
      if (body[j] === '(') {
        const argsClose = findMatchingBracket(body, j);
        if (argsClose === -1) break;
        j = argsClose + 1;
      }
      i = j;
    }

    chains.push(body.slice(closeIdx + 1, i).replace(/\s+/g, ' ').trim());
    expectRe.lastIndex = i;
  }
  return chains.sort();
}

/**
 * Map each test() title in `content` to its sorted assertion-chain signature
 * (see extractExpectChains). test.describe(...) is excluded — only individual
 * test() (including test.skip/.only/.fixme) bodies are signed.
 */
export function extractIntentSignatures(content: string): Map<string, string[]> {
  const signatures = new Map<string, string[]>();
  const testRe = /\btest(?:\.(?!describe\b)\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = testRe.exec(content)) !== null) {
    const title = m[2];
    const arrowIdx = content.indexOf('=>', testRe.lastIndex);
    if (arrowIdx === -1) continue;
    const braceIdx = content.indexOf('{', arrowIdx);
    if (braceIdx === -1) continue;
    const braceEnd = findMatchingBracket(content, braceIdx);
    if (braceEnd === -1) continue;
    signatures.set(title, extractExpectChains(content.slice(braceIdx + 1, braceEnd)));
  }
  return signatures;
}

/**
 * Compare intent signatures between the existing spec and a proposed fix.
 * Returns null when every test present in both still asserts the same
 * things; otherwise a human-readable description of what changed.
 * Tests dropped entirely are not reported here — safeWrite's block-drop
 * guard already refuses those writes.
 */
export function describeIntentViolation(existing: string, next: string): string | null {
  const before = extractIntentSignatures(existing);
  const after = extractIntentSignatures(next);

  const changes: string[] = [];
  for (const [title, beforeChains] of before) {
    const afterChains = after.get(title);
    if (!afterChains) continue;
    if (JSON.stringify(beforeChains) !== JSON.stringify(afterChains)) {
      changes.push(
        `"${title}"\n      before: ${beforeChains.join(', ') || '(no assertions)'}\n      after:  ${afterChains.join(', ') || '(no assertions)'}`,
      );
    }
  }

  if (changes.length === 0) return null;
  return `would change WHAT ${changes.length === 1 ? 'a test' : 'tests'} assert — a fix may change HOW a test reaches an assertion, never WHAT it asserts:\n    ${changes.join('\n    ')}`;
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
  verdict: 'code_bug' | 'app_bug' | 'unclear' | 'flaky' | 'transient';
  rootCause: string;
  /** Only present when verdict is 'app_bug' — describes what the app actually does. */
  actualBehavior?: string;
  fixedFiles: string[];
  /** Files the proposed fix would have rewritten unsafely (dropped tests / drastic shrink) — not written. */
  blockedWrites: { path: string; reason: string; diff: string }[];
  lesson: { problemClass: string; rule: string } | null;
  verifyOutput: string;
  budgetExceeded: boolean;
  /**
   * True when this attempt's outcome has the same failureSignature as the failure
   * that triggered it — the previous fix had no effect. Callers should stop
   * retrying rather than repeating a fix that won't help.
   */
  noProgress: boolean;
  /**
   * Signature of this attempt's outcome (the re-verification output if the fix
   * was applied, otherwise the input failureOutput unchanged). Pass this as
   * `previousSignature` to the next call to enable no-progress detection.
   */
  signature: string;
}

/**
 * Core fix cycle: call Claude to diagnose a failure, write corrections, save the
 * lesson, re-run the spec, and record any newly passing tests.
 *
 * Exported so generate-test and CLI fix loops can call it directly.
 * Pass a TokenBudget to track cumulative cost across multiple attempts, and
 * `previousSignature` (the `signature` returned by the prior call) to enable the
 * no-progress detector.
 */
export async function autoFixFailure(
  failureOutput: string,
  pattern?: string,
  budget?: TokenBudget,
  previousSignature?: string,
): Promise<AutoFixResult> {
  const signature = failureSignature(failureOutput);

  // No-progress detector: if this failure is identical to the one the previous
  // attempt was given (same failing tests, same error/locator/expectation), the
  // previous fix had no effect. Stop here rather than spending tokens on a
  // diagnosis that will most likely repeat.
  if (previousSignature !== undefined && signature === previousSignature) {
    return {
      fixed: false,
      verdict: 'unclear',
      rootCause: 'No progress — this failure is identical to the one before the previous fix attempt (same failing test(s), same error). Stopping rather than repeating a fix that had no effect.',
      fixedFiles: [],
      blockedWrites: [],
      lesson: null,
      verifyOutput: failureOutput,
      budgetExceeded: false,
      noProgress: true,
      signature,
    };
  }

  if (budget?.exceeded) {
    return { fixed: false, verdict: 'unclear', rootCause: '', fixedFiles: [], blockedWrites: [], lesson: null, verifyOutput: '', budgetExceeded: true, noProgress: false, signature };
  }

  // Retry pre-check: re-run the failing test(s) once before spending any tokens.
  // If they pass on retry, classify by what the original failure looked like:
  //   - connectivity/navigation error  →  'transient' (app was unavailable, not a test issue)
  //   - locator/element timeout        →  'flaky'     (timing/race condition in the test)
  const failingSpecs = [...new Set(parseFailingTestsFromOutput(failureOutput).map(f => f.spec))];
  const retryPattern = failingSpecs.length === 1 ? failingSpecs[0] : pattern;
  if (retryPattern) {
    const retryOutput = await runTests(retryPattern);
    if (!retryOutput.includes('failed') && !retryOutput.includes('Error')) {
      const verdict = isInfraFailure(failureOutput) ? 'transient' : 'flaky';
      const rootCause = verdict === 'transient'
        ? 'Test(s) passed on re-run — original failure was a connectivity or navigation error. The app may have been temporarily unavailable. No code changes made.'
        : 'Test(s) passed on re-run — failure looks like a timing or race condition. Consider adding `retries: 1` in playwright.config.ts or a more resilient wait. No code changes made.';
      return { fixed: false, verdict, rootCause, fixedFiles: [], blockedWrites: [], lesson: null, verifyOutput: retryOutput, budgetExceeded: false, noProgress: false, signature: failureSignature(retryOutput) };
    }
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

  // Pre-flight budget check — the fix loop aborts a call outright if even a
  // worst-case (no cache hit, full output) estimate would push spend past the
  // configured TokenBudget. Generation tools (POMs, e2e specs) use the same
  // TokenBudget.wouldExceed() helper but only warn, never abort — see
  // generate-test.ts / generate-pom.ts.
  const MAX_OUTPUT_TOKENS = 8192;
  const IMAGE_TOKEN_ESTIMATE = 1500; // rough cost of one screenshot at the resolutions we send
  const systemBlocks = await getSystemBlocks();
  const estimatedInputTokens = TokenBudget.estimateTokens(
    systemBlocks.map((b) => b.text).join('') + existingContext + domSection + failureOutput + TASK_PROMPT,
  ) + screenshotBlocks.length * IMAGE_TOKEN_ESTIMATE;

  if (budget?.wouldExceed(estimatedInputTokens, MAX_OUTPUT_TOKENS)) {
    return {
      fixed: false,
      verdict: 'unclear',
      rootCause: `Pre-flight estimate (~${estimatedInputTokens} input + up to ${MAX_OUTPUT_TOKENS} output tokens) would push spend past the $${budget.limitUsd.toFixed(2)} budget — aborting before sending. Increase --budget or investigate manually.`,
      fixedFiles: [],
      blockedWrites: [],
      lesson: null,
      verifyOutput: '',
      budgetExceeded: true,
      noProgress: false,
      signature,
    };
  }

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
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
    return { fixed: false, verdict: 'unclear', rootCause: `Claude API error: ${err.message}`, fixedFiles: [], blockedWrites: [], lesson: null, verifyOutput: '', budgetExceeded: false, noProgress: false, signature };
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
    return { fixed: false, verdict: 'unclear', rootCause: 'Claude returned invalid JSON', fixedFiles: [], blockedWrites: [], lesson: null, verifyOutput: '', budgetExceeded: false, noProgress: false, signature };
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
      blockedWrites: [],
      lesson: null,
      verifyOutput: '',
      budgetExceeded: false,
      noProgress: false,
      signature,
    };
  }

  // Code bug or unclear — attempt to fix the test code. A proposed fix that would
  // shrink a populated spec, drop existing test()/describe() blocks, or change
  // WHAT a test asserts (rather than HOW it reaches the assertion) is refused.
  const fixedFiles: string[] = [];
  const blockedWrites: { path: string; reason: string; diff: string }[] = [];
  for (const file of parsed.files ?? []) {
    const abs = join(ROOT, file.path);

    if (file.path.startsWith('tests/') && file.path.endsWith('.spec.ts')) {
      try {
        const existing = await readFile(abs, 'utf-8');
        const violation = describeIntentViolation(existing, file.content);
        if (violation) {
          blockedWrites.push({ path: file.path, reason: violation, diff: unifiedDiff(existing, file.content, abs) });
          continue;
        }
      } catch { /* new file — nothing to preserve */ }
    }

    const result = await safeWrite(abs, file.content);
    if (result.ok) {
      fixedFiles.push(file.path);
    } else {
      blockedWrites.push({ path: file.path, reason: result.reason ?? 'unsafe overwrite', diff: result.diff });
    }
  }

  // Persist lesson
  const lesson = parsed.lesson
    ? { problemClass: parsed.lesson.problem_class, rule: parsed.lesson.rule }
    : null;
  if (lesson) await appendLearnedRule({ problemClass: lesson.problemClass, rule: lesson.rule });

  // Re-run to verify — use the detected spec path when no explicit pattern was given,
  // so we don't run the entire suite just to confirm a single fix.
  let verifyOutput = '';
  if (fixedFiles.length > 0) {
    const verifyPattern = pattern ?? (failingSpecs.length === 1 ? failingSpecs[0] : undefined);
    verifyOutput = await runTests(verifyPattern);
    const passingTests = parsePassingTests(verifyOutput);
    await recordPassingTests(passingTests);
    const passingNames = passingTests.map(t => { const s = t.title.indexOf(' › '); return s === -1 ? t.title : t.title.substring(s + 3); });
    await markBacklogEntriesCovered(passingNames).catch(() => { /* non-fatal */ });
  }

  const failed = verifyOutput.includes('failed') || verifyOutput.includes('Error');
  const fixed = fixedFiles.length > 0 && !failed;

  return {
    fixed,
    verdict,
    rootCause: parsed.root_cause,
    fixedFiles,
    blockedWrites,
    lesson,
    verifyOutput,
    budgetExceeded: budget?.exceeded ?? false,
    noProgress: false,
    signature: verifyOutput ? failureSignature(verifyOutput) : signature,
  };
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

  const { verdict, rootCause, actualBehavior, fixedFiles, blockedWrites, lesson } = await autoFixFailure(failureOutput, args.pattern);

  const verdictLabel = verdict === 'app_bug' ? '⚠️  Application bug' : verdict === 'code_bug' ? '🔧 Code bug' : verdict === 'flaky' ? '🌀 Flaky test' : verdict === 'transient' ? '⚡ Transient infrastructure failure' : '❓ Unclear';
  const lines: string[] = [`## Verdict\n${verdictLabel}`, `\n## Root cause\n${rootCause}`];

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

  if (blockedWrites.length) {
    lines.push('\n## ⛔ Blocked writes — needs human review');
    for (const b of blockedWrites) {
      lines.push(`  - ${b.path}: ${b.reason}`, '```diff', b.diff.trimEnd(), '```');
    }
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
