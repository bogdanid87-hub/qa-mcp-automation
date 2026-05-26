import { readFile, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import * as readline from 'readline';
import { generateTestTool } from './tools/generate-test.js';
import { runTests } from './tools/run-tests.js';
import { readTestCases, findSimilarTests, type TestEntry } from './tools/test-registry.js';
import { autoFixFailure } from './tools/investigate-fix.js';
import { TokenBudget } from './tools/budget.js';

const DEFAULT_BUDGET_USD = 0.30;

const ROOT = process.cwd();
const TRACKED_DIRS = ['pages', 'tests', 'fixtures'];
const TRACKED_EXTRAS = ['TEST_CASES.md', 'src/prompts/learned-rules.md'];

// ---------------------------------------------------------------------------
// API key — read from environment or fall back to .claude/settings.local.json
// ---------------------------------------------------------------------------
async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found — generateTestTool will report the missing key */ }
}

// ---------------------------------------------------------------------------
// File change tracking
// ---------------------------------------------------------------------------
async function snapshotFiles(): Promise<Map<string, number>> {
  const snap = new Map<string, number>();

  for (const dir of TRACKED_DIRS) {
    try {
      for (const f of (await readdir(join(ROOT, dir))).filter(f => f.endsWith('.ts'))) {
        const abs = join(ROOT, dir, f);
        snap.set(abs, (await stat(abs)).mtimeMs);
      }
    } catch { /* dir may not exist yet */ }
  }

  for (const rel of TRACKED_EXTRAS) {
    try {
      const abs = join(ROOT, rel);
      snap.set(abs, (await stat(abs)).mtimeMs);
    } catch { /* file may not exist yet */ }
  }

  return snap;
}

async function diffFiles(before: Map<string, number>): Promise<{ created: string[]; edited: string[] }> {
  const created: string[] = [];
  const edited: string[] = [];

  for (const dir of TRACKED_DIRS) {
    try {
      for (const f of (await readdir(join(ROOT, dir))).filter(f => f.endsWith('.ts'))) {
        const abs = join(ROOT, dir, f);
        const rel = `${dir}/${f}`;
        const mtime = (await stat(abs)).mtimeMs;
        if (!before.has(abs)) created.push(rel);
        else if (mtime > before.get(abs)!) edited.push(rel);
      }
    } catch { /* skip */ }
  }

  for (const rel of TRACKED_EXTRAS) {
    try {
      const abs = join(ROOT, rel);
      const mtime = (await stat(abs)).mtimeMs;
      if (!before.has(abs)) created.push(rel);
      else if (mtime > before.get(abs)!) edited.push(rel);
    } catch { /* skip */ }
  }

  return { created, edited };
}

function printDiff(created: string[], edited: string[]): void {
  if (!created.length && !edited.length) return;
  const bar = '─'.repeat(48);
  console.log(`\n${bar}`);
  if (created.length) {
    console.log('  Created:');
    for (const f of created) console.log(`    + ${f}`);
  }
  if (edited.length) {
    console.log('  Edited:');
    for (const f of edited) console.log(`    ~ ${f}`);
  }
  console.log(`${bar}\n`);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): {
  filePath?: string;
  description?: string;
  pagePaths?: string[];
  testName?: string;
} {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return {
    filePath: raw['file'],
    description: raw['description'],
    pagePaths: raw['page_paths']?.split(',').map(p => p.trim()),
    testName: raw['test_name'],
  };
}

/**
 * Parse metadata embedded in the description file as leading comment lines:
 *   # test_name: login
 *   # page_paths: /login, /
 * These lines are stripped from the description and returned separately.
 * CLI flags take priority over file metadata if both are provided.
 */
function parseFileMetadata(raw: string): {
  description: string;
  testName?: string;
  pagePaths?: string[];
} {
  const lines = raw.split('\n');
  let testName: string | undefined;
  let pagePaths: string[] | undefined;
  const descLines: string[] = [];

  for (const line of lines) {
    const meta = line.match(/^#\s*(test_name|page_paths)\s*:\s*(.+)/i);
    if (meta) {
      const [, key, value] = meta;
      if (key.toLowerCase() === 'test_name') testName = value.trim();
      if (key.toLowerCase() === 'page_paths') {
        const paths = value.split(',').map(p => p.trim()).filter(Boolean);
        if (paths.length) pagePaths = paths;
      }
    } else if (line.startsWith('#')) {
      // skip other comment/instruction lines
    } else {
      descLines.push(line);
    }
  }

  return { description: descLines.join('\n').trim(), testName, pagePaths };
}

// ---------------------------------------------------------------------------
// Negative test selection
// ---------------------------------------------------------------------------
interface NegativeProposal {
  title: string;
  detail: string;
}

/** Extract proposed negative tests from the generate_test output text. */
function parseProposedNegatives(output: string): NegativeProposal[] {
  const proposals: NegativeProposal[] = [];
  // Matches lines like:   1. **title** — detail text
  const re = /^\s+\d+\.\s+\*\*(.+?)\*\*\s+[—-]\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    proposals.push({ title: m[1].trim(), detail: m[2].trim() });
  }
  return proposals;
}

/** Resolve the spec file that was just created or edited (used as context hint). */
function findSpecFile(created: string[], edited: string[]): string | undefined {
  return [...created, ...edited].find(f => f.startsWith('tests/') && f.endsWith('.spec.ts'));
}

// ---------------------------------------------------------------------------
// Interactive helpers
// ---------------------------------------------------------------------------
function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function askYesNo(question: string): Promise<boolean> {
  return (await ask(question)).toLowerCase() === 'y';
}

function printSimilarTests(similar: TestEntry[]): void {
  const bar = '─'.repeat(48);
  console.log(`\n${bar}`);
  console.log('  ⚠️  Similar test(s) already exist:');
  for (const t of similar) {
    console.log(`\n  #${t.num}  ${t.describe} › ${t.name}`);
    console.log(`       in ${t.spec}`);
  }
  console.log(`\n${bar}`);
}

// ---------------------------------------------------------------------------
// Broken-test annotation
// ---------------------------------------------------------------------------
function parseFailingTestNames(output: string): string[] {
  const names: string[] = [];
  const re = /\d+\)\s+\[chromium\]\s+›\s+[^›\n]+›\s+[^›\n]+›\s+(.+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) names.push(m[1].trim());
  return [...new Set(names)];
}

type AnnotationKind = 'broken' | 'app_bug';

async function writeTestAnnotation(
  specPath: string,
  failureOutput: string,
  kind: AnnotationKind,
  rootCause: string,
  actualBehavior?: string,
): Promise<void> {
  const abs = join(ROOT, specPath);
  let src: string;
  try { src = await readFile(abs, 'utf-8'); } catch { return; }

  function buildComment(indent: string): string {
    if (kind === 'app_bug') {
      return [
        `${indent}/* ⚠️  APP BUG — This test is correct; the application under test has a defect.`,
        `${indent} * Expected behaviour: ${rootCause}`,
        `${indent} * Actual behaviour:   ${actualBehavior ?? 'see failure output'}`,
        `${indent} * Do NOT change this test — it documents a real bug. Fix the application instead. */`,
      ].join('\n');
    }
    return [
      `${indent}/* ⚠️  BROKEN — failed and exceeded the auto-fix token budget.`,
      `${indent} * Root cause: ${rootCause}`,
      `${indent} * Fix manually or run: npm run fix */`,
    ].join('\n');
  }

  const failingNames = parseFailingTestNames(failureOutput);
  if (failingNames.length === 0) {
    const header = buildComment('') + '\n\n';
    await writeFile(abs, header + src, 'utf-8');
    return;
  }

  let updated = src;
  for (const name of failingNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`([ \\t]*)(test\\s*\\(\\s*['"\`]${escaped}['"\`])`, 'm');
    updated = updated.replace(re, (_, indent, testCall) =>
      `${buildComment(indent)}\n${indent}${testCall}`
    );
  }
  await writeFile(abs, updated, 'utf-8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureApiKey();
  const budget = new TokenBudget(DEFAULT_BUDGET_USD);

  // Resolve description and metadata
  let description = args.description;
  let testName = args.testName;
  let pagePaths = args.pagePaths;

  if (!description && args.filePath) {
    const meta = parseFileMetadata(await readFile(args.filePath, 'utf-8'));
    description = meta.description;
    if (!testName && meta.testName) testName = meta.testName;
    if (!pagePaths && meta.pagePaths) pagePaths = meta.pagePaths;
  }

  if (!description) {
    console.error(
      '\nUsage:\n' +
      '  npm run generate -- --file my-test.txt\n' +
      '  npm run generate -- --file my-test.txt --page_paths /products,/login --test_name search\n' +
      '  npm run generate -- --description "Test the login flow..." [--page_paths /login]\n' +
      '\nTip: add # test_name: and # page_paths: comment lines inside my-test.txt to avoid extra flags.\n',
    );
    process.exit(1);
  }

  // ── Step 0: Similarity check ──────────────────────────────────────────────
  const allTests = await readTestCases();
  if (allTests.length > 0) {
    const similar = findSimilarTests(description, allTests);
    if (similar.length > 0) {
      printSimilarTests(similar);
      const proceed = await askYesNo('Generate a new test anyway? [y/N] ');
      if (!proceed) {
        // Show tests already recorded in the same spec(s) — no API call yet
        const similarSpecs = new Set(similar.map(t => t.spec));
        const similarNums = new Set(similar.map(t => t.num));
        const existingInSpec = allTests.filter(t => similarSpecs.has(t.spec) && !similarNums.has(t.num));
        const existingNames = new Set(allTests.map(t => t.name.toLowerCase()));

        if (existingInSpec.length > 0) {
          const bar = '─'.repeat(48);
          console.log(`\n${bar}`);
          console.log('  Other tests already recorded for this feature:');
          for (const t of existingInSpec) {
            console.log(`\n  #${t.num}  ${t.describe} › ${t.name}`);
          }
          console.log(`\n${bar}\n`);
        }

        // Ask before spending tokens on an API call
        const checkApi = await askYesNo('Check for additional new negative test scenarios? [y/N] ');
        if (!checkApi) {
          console.log('\nExiting.\n');
          process.exit(0);
        }

        console.log('\n⏳ Checking for missing negative tests...\n');
        const propResult = await generateTestTool({ description, page_paths: pagePaths, proposalsOnly: true });
        const propOutput = propResult.content[0]?.text ?? '';

        const rawProps = parseProposedNegatives(propOutput);
        const alreadyPresent = rawProps.filter(p => existingNames.has(p.title.toLowerCase()));
        const newProps = rawProps.filter(p => !existingNames.has(p.title.toLowerCase()));

        if (alreadyPresent.length > 0) {
          console.log('  ℹ️  Already generated (skipped from proposals):');
          for (const p of alreadyPresent) console.log(`     • ${p.title}`);
          console.log('');
        }

        if (newProps.length === 0) {
          console.log('No new negative tests to propose. Exiting.\n');
          process.exit(0);
        }

        const bar = '─'.repeat(48);
        console.log(`${bar}`);
        console.log('  Proposed negative tests:');
        newProps.forEach((p, i) => {
          console.log(`\n  ${i + 1}. ${p.title}`);
          console.log(`     ${p.detail}`);
        });
        console.log(`\n${bar}`);

        const answer = await ask(
          'Generate which negative tests? Enter numbers (e.g. 1,3), "all", or Enter to skip: ',
        );

        let selected: NegativeProposal[] = [];
        if (answer.toLowerCase() === 'all') {
          selected = newProps;
        } else if (answer) {
          const indices = answer.split(/[\s,]+/).map(n => parseInt(n, 10) - 1).filter(i => i >= 0 && i < newProps.length);
          selected = indices.map(i => newProps[i]);
        }

        if (selected.length > 0) {
          const specHint = similar[0]?.spec ? `Add these negative tests to ${similar[0].spec}:\n\n` : 'Add these negative tests:\n\n';
          const negDesc = specHint + selected.map((p, i) => `${i + 1}. ${p.title} — ${p.detail}`).join('\n');

          console.log('\n⏳ Generating negative tests...\n');

          const before = await snapshotFiles();
          const negResult = await generateTestTool({ description: negDesc, page_paths: pagePaths });
          console.log(negResult.content[0]?.text ?? '');

          const negDiff = await diffFiles(before);
          printDiff(negDiff.created, negDiff.edited);

          const run = await askYesNo('Run all tests to verify nothing is broken? [y/N] ');
          if (run) {
            console.log('\n▶ Running full test suite...\n');
            console.log(await runTests());
          } else {
            console.log('\nSkipped. Run `npm test` when ready.\n');
          }
        } else {
          console.log('\nSkipped negative tests. Exiting.\n');
        }

        process.exit(0);
      }
    }
  }

  // ── Step 1: Generate positive test ────────────────────────────────────────
  console.log('\n⏳ Generating test...\n');

  let before = await snapshotFiles();
  const result = await generateTestTool({ description, page_paths: pagePaths, test_name: testName, budget });
  const output = result.content[0]?.text ?? '';
  console.log(output);

  let { created, edited } = await diffFiles(before);
  printDiff(created, edited);

  // ── Retry loop if initial fix attempt failed ───────────────────────────────
  if (result._meta && !result._meta.passing && result._meta.specFile) {
    const specFile: string = result._meta.specFile;
    let lastFailureOutput: string = result._meta.lastFailureOutput ?? '';
    let stillFailing = true;

    while (stillFailing) {
      const budgetBar = '─'.repeat(48);
      console.log(`\n${budgetBar}`);
      console.log(`  Token budget used: ${budget.summary}`);
      console.log(`${budgetBar}`);

      const retry = await askYesNo('Test is still failing. Attempt another fix? [y/N] ');
      if (!retry) {
        console.log('\n⚠️  Writing BROKEN comment into the spec file...');
        await writeTestAnnotation(specFile, lastFailureOutput, 'broken', 'Could not auto-fix — see npm run fix');
        console.log(`  Done. Open ${specFile} to review.\n`);
        break;
      }

      if (budget.exceeded) {
        console.log(`\n⚠️  Token budget of $${budget.limitUsd.toFixed(2)} reached (${budget.summary}).`);
        const continueAnyway = await askYesNo('Continue spending tokens anyway? [y/N] ');
        if (!continueAnyway) {
          console.log('\n⚠️  Writing BROKEN comment into the spec file...');
          await writeTestAnnotation(specFile, lastFailureOutput, 'broken', 'Exceeded token budget during auto-fix');
          console.log(`  Done. Open ${specFile} to review.\n`);
          break;
        }
      }

      console.log('\n⏳ Attempting another fix...\n');
      const newFailureOutput = await runTests(specFile);
      const fix = await autoFixFailure(newFailureOutput, specFile, budget);

      if (fix.verdict === 'app_bug') {
        console.log('\n⚠️  Application bug detected — the test is correct, the site is broken.');
        console.log(`  What the site does: ${fix.actualBehavior ?? fix.rootCause}`);
        console.log('  Writing APP BUG annotation into the spec file...');
        await writeTestAnnotation(specFile, newFailureOutput, 'app_bug', fix.rootCause, fix.actualBehavior);
        console.log(`  Done. The test was NOT modified — it documents a real defect.\n`);
        stillFailing = false;
      } else if (fix.fixed) {
        const fixedPassed = (fix.verifyOutput.match(/✓/g) ?? []).length;
        console.log(`\n✅ Fixed — ${fixedPassed} test${fixedPassed === 1 ? '' : 's'} now passing — recorded in TEST_CASES.md`);
        if (fix.lesson) console.log(`  Lesson learned: ${fix.lesson.rule}`);
        stillFailing = false;
      } else {
        lastFailureOutput = fix.verifyOutput || newFailureOutput;
        console.log(`\n❌ Still failing. Root cause: ${fix.rootCause}`);
      }
    }
  }

  // ── Step 2: Offer negative tests ──────────────────────────────────────────
  const allTestsAfter = await readTestCases();
  const existingNames = new Set(allTestsAfter.map(t => t.name.toLowerCase()));

  const rawProposals = parseProposedNegatives(output);
  const alreadyPresent = rawProposals.filter(p => existingNames.has(p.title.toLowerCase()));
  const proposals = rawProposals.filter(p => !existingNames.has(p.title.toLowerCase()));

  if (alreadyPresent.length > 0) {
    console.log('  ℹ️  Already generated (skipped from proposals):');
    for (const p of alreadyPresent) console.log(`     • ${p.title}`);
    console.log('');
  }

  if (proposals.length > 0) {
    const bar = '─'.repeat(48);
    console.log(`${bar}`);
    console.log('  Proposed negative tests:');
    proposals.forEach((p, i) => {
      console.log(`\n  ${i + 1}. ${p.title}`);
      console.log(`     ${p.detail}`);
    });
    console.log(`\n${bar}`);

    const answer = await ask(
      'Generate which negative tests? Enter numbers (e.g. 1,3), "all", or Enter to skip: ',
    );

    let selected: NegativeProposal[] = [];
    if (answer.toLowerCase() === 'all') {
      selected = proposals;
    } else if (answer) {
      const indices = answer.split(/[\s,]+/).map(n => parseInt(n, 10) - 1).filter(i => i >= 0 && i < proposals.length);
      selected = indices.map(i => proposals[i]);
    }

    if (selected.length > 0) {
      const specFile = findSpecFile(created, edited);
      const specHint = specFile ? `Add these negative tests to ${specFile}:\n\n` : 'Add these negative tests:\n\n';
      const negDesc = specHint + selected.map((p, i) => `${i + 1}. ${p.title} — ${p.detail}`).join('\n');

      console.log('\n⏳ Generating negative tests...\n');

      before = await snapshotFiles();
      const negResult = await generateTestTool({ description: negDesc, page_paths: pagePaths });
      console.log(negResult.content[0]?.text ?? '');

      const negDiff = await diffFiles(before);
      printDiff(negDiff.created, negDiff.edited);

      created = [...created, ...negDiff.created];
      edited = [...new Set([...edited, ...negDiff.edited])];
    }
  }

  // ── Step 3: Optionally run the full suite ─────────────────────────────────
  const run = await askYesNo('Run all tests to verify nothing is broken? [y/N] ');
  if (run) {
    console.log('\n▶ Running full test suite...\n');
    console.log(await runTests());
  } else {
    console.log('\nSkipped. Run `npm test` when ready.\n');
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
