import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { getSystemBlocks, getSystemPrompt, buildUserBlocks, buildUserPrompt } from '../prompts/system.js';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';
import { readFocusedContextForFeature, pomExistsForFeature } from './list-resources.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { runTests } from './run-tests.js';
import { parsePassingTests, recordPassingTests } from './test-registry.js';
import { generateApiTestTool } from './generate-api-test.js';
import { tagSpecAfterRecording } from './tag-tests.js';
import { markBacklogEntriesCovered } from './analyze-coverage.js';
import { autoFixFailure } from './investigate-fix.js';
import { writeTestAnnotation } from './annotations.js';

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

// ── Orchestrator-worker types (complex multi-page flows) ──────────────────────

interface PomPlan {
  file: string;
  is_new: boolean;
  methods: string[];
  page_url?: string;
}

// Planning prompt: Claude outputs a list of POMs + methods, no code.
// Cheap call — output is ~200–500 tokens regardless of flow complexity.
const PLAN_ONLY_HINT = `

IMPORTANT — PLANNING STEP: Do NOT write any TypeScript code. Analyse the test \
description and the DOM snapshots, then list every POM file that must be created \
or updated and which methods each needs.

Respond with ONLY this JSON (no TypeScript, no explanation):
{
  "poms": [
    {
      "file": "pages/SomePage.ts",
      "is_new": true,
      "methods": ["methodOne", "methodTwo"],
      "page_url": "/some-path"
    }
  ]
}

Rules:
- Only include pages/ files
- is_new: false means the file exists — list only the NEW methods to add, not existing ones
- is_new: true means create from scratch — list every method the test needs
- page_url should match one of the provided page_paths (used to pick the right DOM snapshot)`;

// Per-POM build prompt: local LLM receives one focused task per file.
function buildPomBuildHint(plan: PomPlan): string {
  const task = plan.is_new
    ? `This is a NEW file — create it from scratch following all POM rules.`
    : `This file ALREADY EXISTS (shown in the codebase context above). ADD these new methods without removing any existing ones: ${plan.methods.join(', ')}`;
  return `

IMPORTANT — POM BUILD STEP: Generate ONLY the complete TypeScript for ${plan.file}.
${task}
${plan.page_url ? `Focus on the DOM snapshot for ${plan.page_url} when choosing locators.` : ''}

Respond with this exact JSON:
{
  "summary": "one-sentence description",
  "files": [{ "path": "${plan.file}", "content": "full TypeScript file content" }]
}`;
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

function extractJson(raw: string): string {
  // Strip markdown fences if present
  const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  // Try direct parse; if Claude added preamble text, find the outermost { }
  try { JSON.parse(stripped); return stripped; } catch { /* fall through */ }
  // Find the first { that starts at a line boundary to skip inline { in prose
  const lineStart = stripped.search(/(?:^|\n)\s*\{/);
  const start = lineStart !== -1 ? stripped.indexOf('{', lineStart) : stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  throw new Error('No JSON object found in response');
}

function parseJson(raw: string): GenerateResponse {
  return JSON.parse(extractJson(raw));
}

/**
 * Detect whether a test description is asking for a visual regression test.
 * Strong signals: spec_file under tests/visual/, or explicit visual keywords.
 */
function detectVisualIntent(description: string, specFile?: string): boolean {
  if (specFile?.startsWith('tests/visual/')) return true;
  const desc = description.toLowerCase();
  if (/\bvisual\s+(test|regression|snapshot|baseline)\b/.test(desc)) return true;
  if (/\btoHaveScreenshot\b|\bbaseline\s+screenshot\b/.test(desc)) return true;
  if (/\bcapture\s+(the\s+)?(layout|appearance|screenshot|page)\b/.test(desc)) return true;
  return false;
}

/**
 * Detect whether a test description is asking for a pure API test (request
 * fixture, no browser). The strongest signal is the spec_file path; description
 * keywords are secondary. Deliberately conservative — when ambiguous, default
 * to the UI path so the user gets POM generation and browser context.
 */
function detectApiIntent(description: string, specFile?: string): boolean {
  // Spec file path is the strongest signal
  if (specFile && (specFile.startsWith('tests/api/') || specFile.includes('/api/'))) return true;

  const desc = description.toLowerCase();

  // Explicit API test language
  if (/\bapi\s+test\b|\btest\s+the\s+api\b|\bapi\s+endpoint\b/.test(desc)) return true;

  // HTTP method + path patterns (POST /api/..., GET /api/...)
  if (/\b(post|get|put|patch|delete)\s+\/\S+/.test(desc)) return true;

  // Request fixture / no browser language
  if (/\brequest\s+fixture\b|\bno\s+browser\b|\bwithout\s+browser\b/.test(desc)) return true;

  // Direct API testing language (not "verify against the API" which is UI + reference)
  if (/\bhttp\s+(request|call|endpoint)\b|\brest\s+api\b/.test(desc)) return true;

  return false;
}

export async function generateTestTool(args: {
  description: string;
  test_name?: string;
  page_paths?: string[];
  spec_file?: string;
  proposalsOnly?: boolean;
  /** Override auto-detection. 'api' forces API path; 'visual' forces visual regression path; 'ui'/'e2e' forces browser path. */
  type?: 'auto' | 'ui' | 'e2e' | 'api' | 'visual';
}): Promise<{ content: { type: 'text'; text: string }[]; _meta?: { specFile?: string; lastFailureOutput?: string; passing: boolean } }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY environment variable is not set.' }],
    };
  }

  // Route to visual regression when explicitly requested or keyword-detected.
  const isVisualTest = args.type === 'visual' ||
    (args.type == null && detectVisualIntent(args.description, args.spec_file));

  if (isVisualTest) {
    // Force spec_file into tests/visual/ if not already there
    const visualSpecFile = args.spec_file?.startsWith('tests/visual/')
      ? args.spec_file
      : args.spec_file
        ? `tests/visual/${args.spec_file.replace(/^tests\/[^/]+\//, '')}`
        : undefined;

    return generateTestTool({
      ...args,
      spec_file: visualSpecFile,
      type: 'ui', // visual tests use the browser/UI generation path
    });
  }

  // Route to API generation when explicitly requested or confidently detected.
  // Mixed tests (UI + API calls) fall through to the UI path — the browser path
  // already supports the request fixture alongside page interactions.
  const isApiTest = args.type === 'api' ||
    (args.type !== 'ui' && args.type !== 'e2e' && args.type !== 'visual' && detectApiIntent(args.description, args.spec_file));

  if (isApiTest) {
    return generateApiTestTool({
      description: args.description,
      test_name:   args.test_name,
      spec_file:   args.spec_file,
    });
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

  const description = [
    args.test_name ? `Test name hint: ${args.test_name}` : '',
    args.spec_file ? `Spec file hint: write this test into ${args.spec_file} — create the file if it does not exist, or add to it if it does` : '',
    args.description,
  ].filter(Boolean).join('\n\n');

  const proposalsHint = args.proposalsOnly
    ? '\n\n**Important**: The positive test already exists — do NOT generate any new files. Set `files` to `[]` and `fixture_additions` to `null`. Only populate `proposed_negative_tests` with scenarios not yet implemented.'
    : '';

  const written: string[] = [];

  // Split POM and spec generation into two calls when no POM exists yet.
  // This guarantees the spec call sees the committed POM — eliminating method-name
  // mismatches between the two files that occur when both are invented simultaneously.
  const doPomSpecSplit = !args.proposalsOnly && !(await pomExistsForFeature(featureKeywords));
  let pomGeneratedByLocal = false;

  if (doPomSpecSplit) {
    const localAvailable = await isLocalLlmAvailable();
    const complexFlow = (args.page_paths?.length ?? 0) > 2;
    let usedOrchestratedFlow = false;

    if (complexFlow && localAvailable) {
      // ── Orchestrated: Claude plans (cheap), local LLM builds all POMs in parallel ──
      let plan: { poms: PomPlan[] } | null = null;
      try {
        const planRaw = await callClaude(buildUserBlocks({
          description: description + PLAN_ONLY_HINT,
          existingContext,
          domContext,
        }));
        plan = JSON.parse(extractJson(planRaw));
      } catch {
        // Planning failed — fall through to Claude doing the full POM step
      }

      if (plan && plan.poms.length > 0) {
        const sysPrompt = await getSystemPrompt();

        // Fire all POM builds at once — Ollama queues them; M5 + OLLAMA_NUM_PARALLEL=4
        // processes them concurrently so total time ≈ one call instead of N calls.
        const pomResults = await Promise.all(
          plan.poms.map(async (pomPlan): Promise<GeneratedFile | null> => {
            try {
              const raw = await callLocalLlm(sysPrompt, buildUserPrompt({
                description: description + buildPomBuildHint(pomPlan),
                existingContext,
                domContext,
              }));
              const parsed = parseJson(raw);
              return (parsed.files ?? []).find(f => f.path === pomPlan.file) ?? null;
            } catch {
              return null;
            }
          }),
        );

        // Deduplicate by path — if two plans targeted the same file, last result wins
        const dedupedPomResults = new Map<string, GeneratedFile>();
        for (const file of pomResults) {
          if (file && file.path.startsWith('pages/')) dedupedPomResults.set(file.path, file);
        }

        for (const file of dedupedPomResults.values()) {
          const abs = join(ROOT, file.path);
          // Guard: reject if local model silently dropped existing async methods
          try {
            const existing = await readFile(abs, 'utf-8');
            const missing = [...existing.matchAll(/async\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g)]
              .map(m => m[1])
              .filter(name => !new RegExp(`async\\s+${name}[\\s<(]`).test(file.content));
            if (missing.length > 0) continue;
          } catch { /* new file — no guard needed */ }
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, file.content, 'utf-8');
          written.push(file.path);
        }

        pomGeneratedByLocal = written.some(p => p.startsWith('pages/'));

        // ── Fallback: any planned POM not on disk → generate via Claude API ──
        // This covers files the local model failed, returned null for, or that
        // were rejected by the method-drop guard.
        const writtenSet = new Set(written);
        const missingPoms = plan.poms.filter(p => p.file.startsWith('pages/') && !writtenSet.has(p.file));

        if (missingPoms.length > 0) {
          const updatedContext = await readFocusedContextForFeature(featureKeywords);
          const missingList = missingPoms.map(p => `- ${p.file} (methods: ${p.methods.join(', ')})`).join('\n');
          const fallbackHint = `

IMPORTANT — FALLBACK POM STEP: The local model failed to generate these files.
Generate them now following all POM rules:

${missingList}

Respond with the standard JSON:
{
  "summary": "...",
  "files": [{ "path": "pages/X.ts", "content": "..." }]
}`;
          try {
            const fallbackRaw = await callClaude(buildUserBlocks({
              description: description + fallbackHint,
              existingContext: updatedContext,
              domContext,
            }));
            const fallbackParsed = parseJson(fallbackRaw);
            for (const file of fallbackParsed.files ?? []) {
              if (!file.path.startsWith('pages/')) continue;
              const abs = join(ROOT, file.path);
              await mkdir(dirname(abs), { recursive: true });
              await writeFile(abs, file.content, 'utf-8');
              written.push(file.path);
            }
          } catch { /* fallback failed — spec step will work with what's on disk */ }
        }

        usedOrchestratedFlow = true;
      }
    }

    if (!usedOrchestratedFlow) {
      // ── Standard: single POM call — local for simple flows, Claude otherwise ──
      const useLocal = !complexFlow && localAvailable;

      let pomRaw: string;
      if (useLocal) {
        const sysPrompt = await getSystemPrompt();
        try {
          pomRaw = await callLocalLlm(sysPrompt, buildUserPrompt({
            description: description + POM_ONLY_HINT,
            existingContext,
            domContext,
          }));
          pomGeneratedByLocal = true;
        } catch (err: any) {
          try {
            pomRaw = await callClaude(buildUserBlocks({ description: description + POM_ONLY_HINT, existingContext, domContext }));
          } catch (apiErr: any) {
            return { content: [{ type: 'text', text: `POM step failed (local: ${err.message}, API: ${apiErr.message})` }] };
          }
        }
      } else {
        try {
          pomRaw = await callClaude(buildUserBlocks({ description: description + POM_ONLY_HINT, existingContext, domContext }));
        } catch (err: any) {
          return { content: [{ type: 'text', text: `Claude API error (POM step): ${err.message}` }] };
        }
      }

      let pomParsed: GenerateResponse;
      try {
        pomParsed = parseJson(pomRaw);
      } catch {
        return { content: [{ type: 'text', text: `${useLocal ? LOCAL_MODEL : 'Claude'} returned invalid JSON in POM step.\n\n${pomRaw}` }] };
      }

      for (const file of pomParsed.files ?? []) {
        if (!file.path.startsWith('pages/')) continue;
        const abs = join(ROOT, file.path);
        if (useLocal) {
          try {
            const existing = await readFile(abs, 'utf-8');
            const missing = [...existing.matchAll(/async\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g)]
              .map(m => m[1])
              .filter(name => !new RegExp(`async\\s+${name}[\\s<(]`).test(file.content));
            if (missing.length > 0) { pomGeneratedByLocal = false; continue; }
          } catch { /* new file */ }
        }
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, file.content, 'utf-8');
        written.push(file.path);
      }
    }

    // Re-read context so the spec call sees the committed POMs on disk
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
          ? ['**Proposed additional tests:**', ...negatives.map((t, i) => `  ${i + 1}. **${t.title}** — ${t.description}`)].join('\n')
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

    if (passed > 0) {
      const passingTests = parsePassingTests(testOutput);
      await recordPassingTests(passingTests);
      await tagSpecAfterRecording(specFile.path).catch(() => { /* non-fatal */ });
      const passingNames = passingTests.map(t => { const s = t.title.indexOf(' › '); return s === -1 ? t.title : t.title.substring(s + 3); });
      await markBacklogEntriesCovered(passingNames).catch(() => { /* non-fatal */ });
    }

    const registryName = specFile.path.startsWith('tests/api/') ? 'TEST_API.md' : 'TEST_CASES.md';
    if (passed > 0 && !hasFailed) {
      testRunNote = `✅ ${passed} test${passed === 1 ? '' : 's'} passed — recorded in ${registryName}`;
    } else {
      passing = false;
      lastFailureOutput = testOutput;
      testRunNote = '⚠️ Initial run failed — attempting auto-fix...\n';
      const fix = await autoFixFailure(testOutput, specFile.path);
      if (fix.verdict === 'app_bug') {
        lastFailureOutput = testOutput;
        await writeTestAnnotation(specFile.path, testOutput, 'app_bug', fix.rootCause, fix.actualBehavior);
        testRunNote += [
          '⚠️  Application bug detected — the test is correct but the site behaves differently.',
          `  What the site does: ${fix.actualBehavior ?? fix.rootCause}`,
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
        const parts = [
          `✅ Auto-fix applied — ${fixedPassed} test${fixedPassed === 1 ? '' : 's'} now passing — recorded in TEST_CASES.md`,
          `  Root cause: ${fix.rootCause}`,
        ];
        if (fix.lesson) parts.push(`  Lesson learned: ${fix.lesson.rule}`);
        testRunNote += parts.join('\n');
      } else {
        lastFailureOutput = fix.verifyOutput || testOutput;
        await writeTestAnnotation(specFile.path, lastFailureOutput, 'broken', fix.rootCause);
        testRunNote += [`❌ Could not auto-fix — annotated in the spec with ⚠️ BROKEN`, `  Root cause: ${fix.rootCause}`].join('\n');
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
    const pomNote = pomGeneratedByLocal
      ? `POMs planned by Claude API, built in parallel by ${LOCAL_MODEL} (local)`
      : 'POMs generated first, spec generated using the committed POMs';
    lines.push('', `_(${pomNote} — method names are guaranteed consistent)_`);
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
      '**Proposed additional tests** — call `generate_test` again with the ones you want (none have been written yet):',
      ...negatives.map((t, i) => `  ${i + 1}. **${t.title}** — ${t.description}`),
    );
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    _meta: specFile ? { specFile: specFile.path, lastFailureOutput, passing } : undefined,
  };
}
