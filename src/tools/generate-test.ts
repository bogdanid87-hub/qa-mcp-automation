import Anthropic from '@anthropic-ai/sdk';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { getSystemBlocks, buildUserBlocks } from '../prompts/system.js';
import { readFocusedContextForFeature } from './list-resources.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { runTests } from './run-tests.js';
import { parsePassingTests, recordPassingTests } from './test-registry.js';
import { autoFixFailure } from './investigate-fix.js';
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
  fixture_additions: string | null;
  instructions: string | null;
  proposed_negative_tests?: ProposedNegativeTest[];
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
      content: [
        {
          type: 'text',
          text: 'Error: ANTHROPIC_API_KEY environment variable is not set. Please set it before calling this tool.',
        },
      ],
    };
  }

  const client = new Anthropic({ apiKey });

  // Build context: fixtures + files matching the feature keyword, names-only for the rest
  const featureKeywords = [
    ...(args.test_name ? args.test_name.split(/\W+/) : []),
    ...args.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 10),
  ];
  const existingContext = await readFocusedContextForFeature(featureKeywords);

  // Optionally inspect live pages for accurate locators
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

  const userBlocks = buildUserBlocks({ description: description + proposalsHint, existingContext, domContext });

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: await getSystemBlocks(),
      messages: [{ role: 'user', content: userBlocks }],
    });
    args.budget?.add(
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
    return {
      content: [{ type: 'text', text: `Claude API error: ${err.message}` }],
    };
  }

  // Parse the JSON response
  let parsed: GenerateResponse;
  try {
    const jsonStr = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      content: [{ type: 'text', text: `Claude returned invalid JSON. Raw response:\n\n${raw}` }],
    };
  }

  // proposals-only mode: skip all file I/O and test runs
  if (args.proposalsOnly) {
    const negatives = parsed.proposed_negative_tests ?? [];
    const lines: string[] = [];
    if (negatives.length > 0) {
      lines.push(
        '**Proposed negative tests:**',
        ...negatives.map((t, i) => `  ${i + 1}. **${t.title}** — ${t.description}`),
      );
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // Write files to disk
  const written: string[] = [];
  for (const file of parsed.files ?? []) {
    const abs = join(ROOT, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, 'utf-8');
    written.push(file.path);
  }

  // Handle fixture_additions (full replacement of fixtures/index.ts)
  if (parsed.fixture_additions) {
    const fixturesPath = join(ROOT, 'fixtures', 'index.ts');
    await writeFile(fixturesPath, parsed.fixture_additions, 'utf-8');
    written.push('fixtures/index.ts (updated)');
  }

  // Run the generated spec; auto-fix if it fails
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

    if (passed > 0 && !hasFailed) {
      await recordPassingTests(parsePassingTests(testOutput));
      testRunNote = `✅ ${passed} test${passed === 1 ? '' : 's'} passed — recorded in TEST_CASES.md`;
    } else {
      passing = false;
      lastFailureOutput = testOutput;
      testRunNote = '⚠️ Initial run failed — attempting auto-fix...\n';
      const fix = await autoFixFailure(testOutput, specFile.path, args.budget);
      if (fix.verdict === 'app_bug') {
        lastFailureOutput = testOutput;
        testRunNote += [
          '⚠️  Application bug detected — the test is correct but the site behaves differently.',
          `  What the site does: ${fix.actualBehavior ?? fix.rootCause}`,
          '  The test was NOT modified. It documents a real defect.',
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
        testRunNote += [
          `❌ Could not auto-fix${budgetNote}`,
          `  Root cause: ${fix.rootCause}`,
        ].join('\n');
      }
    }
  }

  const lines: string[] = [
    `✅ ${parsed.summary}`,
    '',
    '**Files written:**',
    ...written.map((p) => `  - ${p}`),
  ];

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
