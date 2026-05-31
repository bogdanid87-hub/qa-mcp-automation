import Anthropic from '@anthropic-ai/sdk';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import * as readline from 'readline';
import { generateTestTool } from './tools/generate-test.js';
import { generateApiTestTool } from './tools/generate-api-test.js';
import { runTests } from './tools/run-tests.js';
import { readTestCases, TESTS_API_PATH, TESTS_E2E_PATH, type TestEntry } from './tools/test-registry.js';
import { autoFixFailure } from './tools/investigate-fix.js';
import { writeTestAnnotation } from './tools/annotations.js';
import { TokenBudget } from './tools/budget.js';

const DEFAULT_BUDGET_USD = 0.30;

const ROOT = process.cwd();
const TRACKED_DIRS = ['pages', 'tests', 'fixtures'];
const TRACKED_EXTRAS = ['TESTS_UI.md', 'TESTS_API.md', 'TESTS_E2E.md', 'src/prompts/learned-rules.md'];

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
async function walkTs(dir: string, snap: Map<string, number>): Promise<void> {
  try {
    const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) await walkTs(`${dir}/${e.name}`, snap);
      else if (e.name.endsWith('.ts')) {
        const abs = join(ROOT, dir, e.name);
        snap.set(abs, (await stat(abs)).mtimeMs);
      }
    }
  } catch { /* dir may not exist yet */ }
}

async function snapshotFiles(): Promise<Map<string, number>> {
  const snap = new Map<string, number>();

  for (const dir of TRACKED_DIRS) {
    await walkTs(dir, snap);
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

  const after = new Map<string, number>();
  for (const dir of TRACKED_DIRS) await walkTs(dir, after);

  for (const [abs, mtime] of after) {
    const rel = abs.replace(ROOT + '/', '');
    if (!before.has(abs)) created.push(rel);
    else if (mtime > before.get(abs)!) edited.push(rel);
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
  noLocal?: boolean;
} {
  const raw: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[key] = argv[++i];
    } else {
      flags.add(key);
    }
  }
  return {
    filePath: raw['file'],
    description: raw['description'],
    pagePaths: raw['page_paths']?.split(',').map(p => p.trim()),
    testName: raw['test_name'],
    noLocal: flags.has('no-local'),
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
  specFile?: string;
} {
  const lines = raw.split('\n');
  let testName: string | undefined;
  let pagePaths: string[] | undefined;
  let specFile: string | undefined;
  const descLines: string[] = [];

  for (const line of lines) {
    const meta = line.match(/^#\s*(test_name|page_paths|spec_file)\s*:\s*(.+)/i);
    if (meta) {
      const [, key, value] = meta;
      if (key.toLowerCase() === 'test_name') testName = value.trim();
      if (key.toLowerCase() === 'page_paths') {
        const paths = value.split(',').map(p => p.trim()).filter(Boolean);
        if (paths.length) pagePaths = paths;
      }
      if (key.toLowerCase() === 'spec_file') specFile = value.trim();
    } else if (line.startsWith('#')) {
      // skip other comment/instruction lines
    } else {
      descLines.push(line);
    }
  }

  return { description: descLines.join('\n').trim(), testName, pagePaths, specFile };
}

/**
 * Split a file's content into multiple test sections, separated by lines
 * containing only three or more dashes (---). Returns an empty array if
 * there is only one section — caller falls through to the single-test flow.
 */
function parseMultipleSections(raw: string): Array<{
  description: string;
  testName?: string;
  pagePaths?: string[];
  specFile?: string;
}> {
  const sections = raw.split(/^-{3,}\s*$/m).map(s => s.trim()).filter(Boolean);
  if (sections.length <= 1) return [];
  return sections.map(s => parseFileMetadata(s));
}

// ---------------------------------------------------------------------------
// Batch mode (multiple tests in one file)
// ---------------------------------------------------------------------------
async function runBatch(
  sections: Array<{ description: string; testName?: string; pagePaths?: string[]; specFile?: string }>,
  budget: TokenBudget,
): Promise<void> {
  console.log(`\n📋 Batch mode — ${sections.length} tests to generate\n`);

  const summary: Array<{ label: string; status: string }> = [];

  // ── API tests: group by spec file → one generation call per spec ──────────
  // Generating section-by-section causes a cascade: auto-fix annotations pollute
  // the file before the next section reads it as "existing content". One combined
  // call produces a clean, complete file without mid-batch side effects.
  const apiSections = sections.filter(s => s.specFile?.startsWith('tests/api/'));
  const nonApiSections = sections.filter(s => !s.specFile?.startsWith('tests/api/'));

  const apiBySpec = new Map<string, typeof apiSections>();
  for (const s of apiSections) {
    const key = s.specFile!;
    if (!apiBySpec.has(key)) apiBySpec.set(key, []);
    apiBySpec.get(key)!.push(s);
  }

  for (const [specFile, group] of apiBySpec) {
    const label = `${specFile} (${group.length} test${group.length === 1 ? '' : 's'})`;
    const bar = '─'.repeat(48);
    console.log(`\n${bar}`);
    console.log(`  API spec: ${specFile}`);
    console.log(`${bar}\n`);

    const combinedDescription = group.length === 1
      ? group[0].description
      : `Generate ALL of the following ${group.length} tests in one complete spec file:\n\n` +
        group.map((s) => `### ${s.testName ?? 'Test'}:\n${s.description}`).join('\n\n---\n\n');

    console.log(`⏳ Generating ${group.length} test${group.length === 1 ? '' : 's'} in one call (no auto-fix in batch)...\n`);
    const before = await snapshotFiles();
    const result = await generateApiTestTool({
      description: combinedDescription,
      spec_file: specFile,
      budget,
      noAutoFix: true,  // prevents annotation cascade; user runs npm run fix after reviewing
    });
    console.log(result.content[0]?.text ?? '');
    const { created, edited } = await diffFiles(before);
    printDiff(created, edited);

    const passing = result._meta?.passing !== false;
    summary.push({ label, status: passing ? '✅' : '❌ failed — run `npm run fix` to investigate' });
  }

  // ── UI/E2E tests: one call per section (existing behaviour) ───────────────
  for (const [i, section] of nonApiSections.entries()) {
    const label = section.testName ?? `test ${i + 1}`;
    const bar = '─'.repeat(48);
    console.log(`\n${bar}`);
    console.log(`  [${i + 1}/${nonApiSections.length}]  ${label}`);
    console.log(`${bar}\n`);

    console.log(`⏳ Generating...\n`);
    const before = await snapshotFiles();
    const result = await generateTestTool({
      description: section.description,
      test_name: section.testName,
      page_paths: section.pagePaths,
      spec_file: section.specFile,
    });
    console.log(result.content[0]?.text ?? '');
    const { created, edited } = await diffFiles(before);
    printDiff(created, edited);

    const passing = result._meta?.passing !== false;
    summary.push({ label, status: passing ? '✅' : '❌ failed' });
  }

  const eq = '═'.repeat(48);
  console.log(`\n${eq}`);
  console.log(`  Batch complete — ${sections.length} test${sections.length === 1 ? '' : 's'}:`);
  for (const { label, status } of summary) console.log(`    ${status}  ${label}`);
  console.log(`  Fix budget used: ${budget.summary}`);
  console.log(`${eq}\n`);
}

// ---------------------------------------------------------------------------
// Negative test selection
// ---------------------------------------------------------------------------
interface NegativeProposal {
  title: string;
  detail: string;
}

/** Extract proposed additional tests from the generate_test output text. */
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

// ---------------------------------------------------------------------------
// Similarity check (Claude-based, replaces keyword heuristic)
// ---------------------------------------------------------------------------

/**
 * Ask Claude whether any existing tests already cover the same scenario as the
 * new description. Returns the matching TestEntry items, or [] on any failure
 * (the check is advisory — errors must never block generation).
 *
 * The test list is marked cacheable so repeated calls in the same session pay
 * the cheap cache-read rate rather than the full input price.
 */
async function claudeSimilarityCheck(
  description: string,
  allTests: TestEntry[],
): Promise<TestEntry[]> {
  if (allTests.length === 0) return [];
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    console.warn('\n⚠️  ANTHROPIC_API_KEY not set — similarity check skipped (duplicate detection disabled).\n');
    return [];
  }

  const testList = allTests
    .map(t => `#${t.num}: ${t.describe} › ${t.name}`)
    .join('\n');

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system:
        'You are a test coverage checker. Given a list of existing Playwright tests ' +
        'and a new test description, identify which existing tests already cover the ' +
        'exact same scenario.\n\n' +
        'Only flag a test as duplicate if it exercises the same user action AND ' +
        'verifies the same outcome — even if worded differently. Do NOT flag tests ' +
        'that cover a different aspect or edge case of the same feature area.\n\n' +
        'Respond with ONLY a JSON array of matching test numbers, e.g. [3, 7] or [].',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Existing tests:\n${testList}`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `New test description:\n${description}`,
          },
        ],
      }],
    });


    const raw = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    const nums = JSON.parse(raw) as number[];
    return allTests.filter(t => nums.includes(t.num));
  } catch (err) {
    console.warn(`\n⚠️  Similarity check failed (${(err as Error).message}) — duplicate detection skipped.\n`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureApiKey();
  if (args.noLocal) process.env.NO_LOCAL_LLM = '1';
  const budget = new TokenBudget(DEFAULT_BUDGET_USD);

  // Resolve description and metadata
  let description = args.description;
  let testName = args.testName;
  let pagePaths = args.pagePaths;
  let specFile: string | undefined;

  if (!description && args.filePath) {
    const fileContent = await readFile(args.filePath, 'utf-8');

    // Multi-test: sections separated by --- lines → batch mode (non-interactive)
    const sections = parseMultipleSections(fileContent);
    if (sections.length > 0) {
      await runBatch(sections, budget);
      process.exit(0);
    }

    const meta = parseFileMetadata(fileContent);
    description = meta.description;
    if (!testName && meta.testName) testName = meta.testName;
    if (!pagePaths && meta.pagePaths) pagePaths = meta.pagePaths;
    if (meta.specFile) specFile = meta.specFile;
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
  const [uiTests, apiTests, e2eTests] = await Promise.all([readTestCases(), readTestCases(TESTS_API_PATH), readTestCases(TESTS_E2E_PATH)]);
  const allTests = [...uiTests, ...apiTests, ...e2eTests];
  if (allTests.length > 0) {
    process.stdout.write('  Checking for existing coverage...\r');
    const similar = await claudeSimilarityCheck(description, allTests);
    process.stdout.write('                                    \r'); // clear the line
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
        const checkApi = await askYesNo('Check for additional test scenarios? [y/N] ');
        if (!checkApi) {
          console.log('\nExiting.\n');
          process.exit(0);
        }

        console.log('\n⏳ Checking for additional test scenarios...\n');
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
          console.log('No additional tests to propose. Exiting.\n');
          process.exit(0);
        }

        const bar = '─'.repeat(48);
        console.log(`${bar}`);
        console.log('  Proposed additional tests:');
        newProps.forEach((p, i) => {
          console.log(`\n  ${i + 1}. ${p.title}`);
          console.log(`     ${p.detail}`);
        });
        console.log(`\n${bar}`);

        const answer = await ask(
          'Generate which additional tests? Enter numbers (e.g. 1,3), "all", or Enter to skip: ',
        );

        let selected: NegativeProposal[] = [];
        if (answer.toLowerCase() === 'all') {
          selected = newProps;
        } else if (answer) {
          const indices = answer.split(/[\s,]+/).map(n => parseInt(n, 10) - 1).filter(i => i >= 0 && i < newProps.length);
          selected = indices.map(i => newProps[i]);
        }

        if (selected.length > 0) {
          const specHint = similar[0]?.spec ? `Add these additional tests to ${similar[0].spec}:\n\n` : 'Add these additional tests:\n\n';
          const negDesc = specHint + selected.map((p, i) => `${i + 1}. ${p.title} — ${p.detail}`).join('\n');

          console.log('\n⏳ Generating additional tests...\n');

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
          console.log('\nSkipped additional tests. Exiting.\n');
        }

        process.exit(0);
      }
    }
  }

  // ── Step 1: Generate positive test ────────────────────────────────────────
  console.log('\n⏳ Generating test...\n');

  let before = await snapshotFiles();
  const isApiTest = specFile?.startsWith('tests/api/');
  const result = isApiTest
    ? await generateApiTestTool({ description, test_name: testName, spec_file: specFile })
    : await generateTestTool({ description, page_paths: pagePaths, test_name: testName, spec_file: specFile });
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
      console.log(`  Fix budget used: ${budget.summary}`);
      console.log(`${budgetBar}`);

      const retry = await askYesNo('Test is still failing. Attempt another fix? [y/N] ');
      if (!retry) {
        console.log('\n⚠️  Writing BROKEN comment into the spec file...');
        await writeTestAnnotation(specFile, lastFailureOutput, 'broken', 'Could not auto-fix — see npm run fix');
        console.log(`  Done. Open ${specFile} to review.\n`);
        break;
      }

      if (budget.exceeded) {
        console.log(`\n⚠️  Fix budget of $${budget.limitUsd.toFixed(2)} reached (${budget.summary}).`);
        const continueAnyway = await askYesNo('Continue spending tokens anyway? [y/N] ');
        if (!continueAnyway) {
          console.log('\n⚠️  Writing BROKEN comment into the spec file...');
          await writeTestAnnotation(specFile, lastFailureOutput, 'broken', 'Fix budget exceeded — run npm run fix to continue');
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

  // ── Step 2: Offer additional tests ────────────────────────────────────────
  const [uiTestsAfter, apiTestsAfter, e2eTestsAfter] = await Promise.all([readTestCases(), readTestCases(TESTS_API_PATH), readTestCases(TESTS_E2E_PATH)]);
  const allTestsAfter = [...uiTestsAfter, ...apiTestsAfter, ...e2eTestsAfter];
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
      const specHint = specFile ? `Add these additional tests to ${specFile}:\n\n` : 'Add these additional tests:\n\n';
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
