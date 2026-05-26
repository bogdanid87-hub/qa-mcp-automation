import Anthropic from '@anthropic-ai/sdk';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { getSystemBlocks, buildUserBlocks } from '../prompts/system.js';
import { readFocusedContextForFeature, pomExistsForFeature } from './list-resources.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { runTests } from './run-tests.js';
import { parsePassingTests, recordPassingTests } from './test-registry.js';
import { autoFixFailure } from './investigate-fix.js';
import { writeTestAnnotation } from './annotations.js';
import { TokenBudget } from './budget.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

interface GeneratedFile {
  path: string;
  content: string;
}

interface ProposedNegativeTest {
  title: string;
  description: string;
}

interface GenerateResponse {
  summary: string;
  files: GeneratedFile[];
  fixture_additions?: string | null;
  instructions?: string | null;
  proposed_negative_tests?: ProposedNegativeTest[];
}

const POM_ONLY_HINT = `

IMPORTANT — POM GENERATION STEP: This is step 1 of 2. Generate ONLY the Page Object Model \
file(s) in pages/ that this test will need. Do NOT generate the test spec. \
Respond with this exact JSON shape (no other fields needed):
{
  "summary": "one-sentence description of what POM was created/updated",
  "files": [{ "path": "pages/SomePage.ts", "content": "full file content" }]
}
If the existing POM already has every locator and method this test needs, set files to [].`;

const SPEC_ONLY_HINT = `

IMPORTANT — SPEC GENERATION STEP: This is step 2 of 2. The POM has already been created \
and is shown in the codebase context above. Generate ONLY the test spec file (tests/) and \
fixture additions if needed. Use the exact class name, constructor signature, and method \
names from the POM as it appears in the context. Do NOT output any pages/ files.`;

function parseJson(raw: string): GenerateResponse {
  const jsonStr = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(jsonStr);
}

export async function generateTestTool(args: {
  description: string;
  test_name?: string;
  page_paths?: string[];
  proposalsOnly?: boolean;
  budget?: TokenBudget;
}): Promise<{ content: { type: 'text'; text: string }[]; _meta?: { specFile?: string; lastFailureOutput?: string; passing: boolean } }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY environment variable is not set.' }],
    };
  }

  const client = new Anthropic({ apiKey });
  const systemBlocks = await getSystemBlocks();

  async function callClaude(userBlocks: ReturnType<typeof buildUserBlocks>): Promise<string> {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemBlocks,
      messages: [{ role: 'user', content: userBlocks }],
    });
    args.budget?.add(
      message.usage.input_tokens,
      message.usage.output_tokens,
      message.usage.cache_creation_input_tokens ?? 0,
      message.usage.cache_read_input_tokens ?? 0,
    );
    return message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  }

  const featureKeywords = [
    ...(args.test_name ? args.test_name.split(/\W+/) : []),
    ...args.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 10),
  ];

  let existingContext = await readFocusedContextForFeature(featureKeywords);

  let domContext = '';
  if (args.page_paths && args.page_paths.length > 0) {
    try {
      const snapshots = await inspectPages(args.page_paths);
      domContext = formatSnapshots(snapshots);
    } catch (err: any) {
      domContext = `(Page inspection failed: ${err.message} — proceeding without DOM snapshot)`;
    }
  }

  const description = args.test_name
    ? `Test name hint: ${args.test_name}\n\n${args.description}`
    : args.description;

  const proposalsHint = args.proposalsOnly
    ? '\n\n**Important**: The positive test already exists — do NOT generate any new files. Set `files` to `[]` and `fixture_additions` to `null`. Only populate `proposed_negative_tests` with scenarios not yet implemented.'
    : '';

  const written: string[] = [];

  // Split POM and spec generation into two calls when no POM exists yet.
  // This guarantees the spec call sees the committed POM — eliminating method-name
  // mismatches between the two files that occur when both are invented simultaneously.
  const doPomSpecSplit = !args.proposalsOnly && !(await pomExistsForFeature(featureKeywords));

  if (doPomSpecSplit) {
    // ── Call 1: POM only ──────────────────────────────────────────────────────
    const pomBlocks = buildUserBlocks({
      description: description + POM_ONLY_HINT,
      existingContext,
      domContext,
    });

    let pomRaw: string;
    try {
      pomRaw = await callClaude(pomBlocks);
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Claude API error (POM step): ${err.message}` }] };
    }

    let pomParsed: GenerateResponse;
    try {
      pomParsed = parseJson(pomRaw);
    } catch {
      return { content: [{ type: 'text', text: `Claude returned invalid JSON in POM step.\n\n${pomRaw}` }] };
    }

    for (const file of pomParsed.files ?? []) {
      if (!file.path.startsWith('pages/')) continue;
      const abs = join(ROOT, file.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.content, 'utf-8');
      written.push(file.path);
    }

    // Re-read context so the spec call sees the real POM on disk
    existingContext = await readFocusedContextForFeature(featureKeywords);
  }

  // ── Call 2 (or only call): spec ───────────────────────────────────────────
  const specDescription = description + proposalsHint + (doPomSpecSplit ? SPEC_ONLY_HINT : '');
  const userBlocks = buildUserBlocks({ description: specDescription, existingContext, domContext });

  let raw: string;
  try {
    raw = await callClaude(userBlocks);
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Claude API error (spec step): ${err.message}` }] };
  }

  let parsed: GenerateResponse;
  try {
    parsed = parseJson(raw);
  } catch {
    return { content: [{ type: 'text', text: `Claude returned invalid JSON.\n\n${raw}` }] };
  }

  // proposals-only: skip all file I/O and test runs
  if (args.proposalsOnly) {
    const negatives = parsed.proposed_negative_tests ?? [];
    return {
      content: [{
        type: 'text',
        text: negatives.length > 0
          ? ['**Proposed negative tests:**', ...negatives.map((t, i) => `  ${i + 1}. **${t.title}** — ${t.description}`)].join('\n')
          : '',
      }],
    };
  }

  for (const file of parsed.files ?? []) {
    const abs = join(ROOT, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, 'utf-8');
    written.push(file.path);
  }

  if (parsed.fixture_additions) {
    await writeFile(join(ROOT, 'fixtures', 'index.ts'), parsed.fixture_additions, 'utf-8');
    written.push('fixtures/index.ts (updated)');
  }

  const specFile = (parsed.files ?? []).find(
    (f) => f.path.startsWith('tests/') && f.path.endsWith('.spec.ts'),
  );
  let testRunNote = '';
  let passing = true;
  let lastFailureOutput = '';

  if (specFile) {
    const testOutput = await runTests(specFile.path);
    const passed = (testOutput.match(/✓/g) ?? []).length;
    const hasFailed = testOutput.includes('failed') || (testOutput.match(/✗/g) ?? []).length > 0;

    if (passed > 0) await recordPassingTests(parsePassingTests(testOutput));

    if (passed > 0 && !hasFailed) {
      testRunNote = `✅ ${passed} test${passed === 1 ? '' : 's'} passed — recorded in TEST_CASES.md`;
    } else {
      passing = false;
      lastFailureOutput = testOutput;
      testRunNote = '⚠️ Initial run failed — attempting auto-fix...\n';
      const fix = await autoFixFailure(testOutput, specFile.path, args.budget);
      if (fix.verdict === 'app_bug') {
        lastFailureOutput = testOutput;
        await writeTestAnnotation(specFile.path, testOutput, 'app_bug', fix.rootCause, fix.actualBehavior);
        testRunNote += [
          '⚠️  Application bug detected — the test is correct but the site behaves differently.',
          `  What the site does: ${fix.actualBehavior ?? fix.rootCause}`,
          '  The test was NOT modified — annotated in the spec with ⚠️ APP BUG.',
        ].join('\n');
      } else if (fix.fixed) {
        passing = true;
        const fixedPassed = (fix.verifyOutput.match(/✓/g) ?? []).length;
        const parts = [
          `✅ Auto-fix applied — ${fixedPassed} test${fixedPassed === 1 ? '' : 's'} now passing — recorded in TEST_CASES.md`,
          `  Root cause: ${fix.rootCause}`,
        ];
        if (fix.lesson) parts.push(`  Lesson learned: ${fix.lesson.rule}`);
        testRunNote += parts.join('\n');
      } else {
        lastFailureOutput = fix.verifyOutput || testOutput;
        const budgetNote = fix.budgetExceeded ? ' (token budget reached)' : '';
        await writeTestAnnotation(specFile.path, lastFailureOutput, 'broken', fix.rootCause);
        testRunNote += [`❌ Could not auto-fix${budgetNote} — annotated in the spec with ⚠️ BROKEN`, `  Root cause: ${fix.rootCause}`].join('\n');
      }
    }
  }

  const lines: string[] = [
    `✅ ${parsed.summary}`,
    '',
    '**Files written:**',
    ...written.map((p) => `  - ${p}`),
  ];

  if (doPomSpecSplit && written.some((p) => p.startsWith('pages/'))) {
    lines.push('', '_(POM generated first, spec generated using the committed POM — method names are guaranteed consistent)_');
  }

  if (args.page_paths?.length) {
    lines.push('', `**Pages inspected for locators:** ${args.page_paths.join(', ')}`);
  }

  if (parsed.instructions) {
    lines.push('', '**Manual steps required:**', parsed.instructions);
  }

  if (testRunNote) {
    lines.push('', testRunNote);
  }

  const negatives = parsed.proposed_negative_tests ?? [];
  if (negatives.length > 0) {
    lines.push(
      '',
      '**Proposed negative tests** — call `generate_test` again with the ones you want (none have been written yet):',
      ...negatives.map((t, i) => `  ${i + 1}. **${t.title}** — ${t.description}`),
    );
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    _meta: specFile ? { specFile: specFile.path, lastFailureOutput, passing } : undefined,
  };
}
