import { WORKSPACE_PATHS, ensureWorkspace } from '../workspace.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'fs/promises';
import { readTestCases, readBrokenTests } from './test-registry.js';
import { readAppKnowledge, readAppLimitations } from './generate-app-knowledge.js';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `\
You are a QA analyst for automationexercise.com, a practice e-commerce website.

Given a PRD (or feature description), identify every feature or user flow, classify
it by risk, and output test case suggestions in a structured file format.

## Risk — the intrinsic criticality of the FEATURE being tested

Apply these strictly. When a test touches money or blocks a purchase path, it is critical.

critical — Direct revenue impact. Failure prevents purchases or causes financial errors.
           APPLY when: cart totals change, checkout is blocked, a user could be charged
           the wrong amount, or a completed order could go missing.
           Examples: checkout, payment, cart totals, order confirmation,
           ALSO: any "move item" flow that changes what a user would be charged at checkout.

high     — Trust or data integrity. Failure erodes confidence or surfaces wrong data.
           APPLY when: data a user saved could silently disappear or be corrupted.
           Examples: login/registration, account management, order history, pricing accuracy,
           ALSO: persistence of any user-created list (saved items, wishlists) across sessions.

medium   — Conversion impact. Failure reduces purchase likelihood without blocking it.
           Examples: product search, filtering, navigation, product detail accuracy,
           feature discoverability (button visible, section renders in correct position).

low      — Minor UX or content. Rarely causes abandonment.
           Examples: static pages, newsletter, social links, error pages, empty-state messages.

## Priority — the urgency to WRITE THIS TEST (may differ from risk)

Priority matches risk by default. Raise it above risk when:
- The test covers the dominant user path while only an optional variant currently exists.
  Example: a form always tested WITH an optional file → no-file test is medium priority
  even if the feature is low risk, because most users don't attach files.
- This would be the only test for a given flow — any regression is invisible.
- A regression here would not be caught by any existing test.

## Note field (optional)
Include a note when priority diverges from risk. Omit otherwise.

## Output format

Output ONLY test blocks — no preamble, no prose outside the blocks, no markdown fences.
Separate every block with a line containing exactly three dashes: ---

Each block must follow this exact structure:

# test_name: kebab-case-descriptive-name
# spec_file: tests/ui/feature.spec.ts
# page_paths: /path1, /path2
# source: direct|suggested
# risk: critical|high|medium|low
# priority: critical|high|medium|low
# note: optional — only include when priority differs from risk
# reason: One sentence explaining why this risk level applies.

Plain description or numbered steps of what the test does and asserts.
Be specific enough that a developer can implement it without reading the PRD.

source field:
- direct    — maps to a specific named feature, endpoint, or requirement in the source.
              Omitting this test would leave a documented requirement uncovered.
- suggested — Claude's addition: a negative case, boundary condition, or complementary
              scenario not explicitly mentioned. Valuable but requires human judgement.

spec_file rules:
- tests/api/  for direct API tests (HTTP requests, status codes, response validation — no browser)
              Name by resource: tests/api/products.spec.ts, tests/api/auth.spec.ts
- tests/e2e/  for multi-page journeys (checkout, registration flows, full purchase)
- tests/ui/   for single-feature browser tests (cart, search, forms)
- Group related tests in the same file (all product API tests → tests/api/products.spec.ts)

---

## Ordering rules — follow exactly

1. Output all direct blocks first, then all suggested blocks.

2. Within the direct group:
   - A source is "numbered" ONLY when items carry an explicit numeric prefix in the
     original text: "API 1:", "API 2:", "Test Case 3:", "US-01:", "Req-4:", etc.
   - When the source IS numbered: preserve that numbering order exactly.
     Do NOT re-sort by risk or priority — traceability back to the source takes priority.
   - When the source is NOT numbered (e.g. named sections like "UI Placement:",
     "The List:", "Move Back:", prose paragraphs, bullet lists without numeric labels):
     order by priority: critical → high → medium → low.

3. Within the suggested group: always order by priority: critical → high → medium → low.
   Suggested tests never follow source numbering because they are not derived from a
   specific numbered item.

## Other rules
- test_name must be unique, lowercase, hyphen-separated. When the source document names
  the item explicitly (e.g. "API 5: POST To Search Product", "Test Case 12", "US-03"),
  derive test_name directly from that original name rather than inventing a descriptive one:
  "API 5: POST To Search Product" → api-5-post-to-search-product
  "Test Case 12 — Login" → test-case-12-login
  This preserves traceability back to the source document.
- page_paths should list every page the test navigates to on automationexercise.com
- Generate the happy path AND the most important negative/edge cases as separate blocks
- Do NOT suggest tests already in the covered list — only genuinely new scenarios
- For each feature generate 2–4 blocks (happy path + key failure cases), not just one
- Keep descriptions concrete: what action, what assertion, what data
- When the source document contains exact quoted strings (error messages, success messages,
  field names), reproduce them VERBATIM in the test description — never paraphrase or split
  a single message into "X or Y" alternatives. Example: if the source says the message is
  "Bad request, email or password parameter is missing in POST request." then write exactly
  that string in the description, not "Bad request" or "email parameter is missing".
`;

/**
 * Read unresolved test_names from GAPS_BACKLOG.md so we don't re-suggest
 * gaps that have already been identified (even if not yet generated).
 */
async function readBacklogTestNames(): Promise<string[]> {
  const BACKLOG_PATH = WORKSPACE_PATHS.gapsBacklog;
  try {
    const content = await readFile(BACKLOG_PATH, 'utf-8');
    const names: string[] = [];
    for (const line of content.split('\n')) {
      // Format written by analyze_prd / analyze_coverage: "- test-name-in-kebab-case"
      // Resolved entries are struck through: "- ~~test-name~~"
      const m = line.match(/^- (.+)$/);
      if (!m) continue;
      const name = m[1].trim();
      if (name.startsWith('~~')) continue; // resolved — skip
      names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

export function buildCoverageList(
  passing: Awaited<ReturnType<typeof readTestCases>>,
  broken: Awaited<ReturnType<typeof readBrokenTests>>,
  backlogNames: string[] = [],
): string {
  const covered = [
    ...passing.map(t => `${t.describe} › ${t.name}`),
    ...broken.map(t => `${t.describe} › ${t.name}`),
  ];
  const inBacklog = backlogNames.map(n => `${n} (in gap backlog — already identified, not yet generated)`);
  const all = [...covered, ...inBacklog];
  if (all.length === 0) return 'No existing test coverage.';
  return `Already covered or queued — do NOT suggest tests for these:\n${all.map(n => `- ${n}`).join('\n')}`;
}

export interface PrdFile {
  data: string;           // base64-encoded content
  mediaType: string;      // 'application/pdf' | 'image/png' | 'image/jpeg' | etc.
}

export async function analyzePrdTool(args: {
  prdContent?: string;    // plain text / markdown (optional when prdFile is provided)
  prdFile?: PrdFile;      // PDF passed directly to Claude
  images?: PrdFile[];     // wireframes, mockups, screenshots
  outputFile?: string;
  tier?: string[];        // e.g. ['critical', 'high'] — omit medium/low
  focus?: string[];       // e.g. ['checkout', 'authentication'] — omit other features
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  await ensureWorkspace();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY is not set.' }] };
  }
  if (!args.prdContent && !args.prdFile) {
    return { content: [{ type: 'text', text: 'Error: provide either prdContent (text) or prdFile (PDF/image).' }] };
  }

  // Load existing coverage (registry) + backlog so we don't re-suggest known gaps
  let coverageList = 'Could not read existing coverage.';
  try {
    const [passing, broken] = await Promise.all([readTestCases(), readBrokenTests()]);
    const backlogNames = await readBacklogTestNames();
    coverageList = buildCoverageList(passing, broken, backlogNames);
  } catch { /* proceed without coverage */ }

  // Load app knowledge base if it exists — enriches analysis with institutional
  // knowledge about known app bugs, recurring gaps, and risk patterns.
  const [appKnowledge, appLimitations] = await Promise.all([readAppKnowledge(), readAppLimitations()]);

  const client = new Anthropic({ apiKey });

  // Build the user message content — text first, then document (PDF), then images.
  // Claude reads all provided media before generating suggestions.
  const knowledgeSection = appKnowledge
    ? `## App knowledge base (known bugs, risk patterns, recurring gaps)\n\n${appKnowledge}\n\n---\n\n`
    : '';
  const limitationsSection = appLimitations
    ? `## Known app limitations — do NOT suggest tests for these features\n\n${appLimitations}\n\n---\n\n`
    : '';

  const userContent: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: knowledgeSection + limitationsSection + coverageList + '\n\n---\n\n## PRD to analyse' +
        (args.prdContent ? '\n\n' + args.prdContent : '\n\n(see attached file)'),
    },
  ];

  if (args.prdFile) {
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: args.prdFile.mediaType as 'application/pdf',
        data: args.prdFile.data,
      },
    } as unknown as Anthropic.TextBlockParam); // SDK types vary by version; cast is safe
  }

  for (const img of (args.images ?? [])) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as 'image/png',
        data: img.data,
      },
    });
  }

  // Scope constraints — appended last so Claude sees them right before responding
  const constraints: string[] = [];
  if (args.tier && args.tier.length > 0) {
    const allowed = args.tier.join(', ');
    constraints.push(`Risk filter: ONLY generate tests where # risk: is one of [${allowed}]. Omit all other risk levels entirely.`);
  }
  if (args.focus && args.focus.length > 0) {
    const areas = args.focus.join(', ');
    constraints.push(`Feature filter: ONLY generate tests related to these areas: ${areas}. Omit all other features entirely.`);
  }
  if (constraints.length > 0) {
    userContent.push({
      type: 'text',
      text: `## Scope constraints — apply strictly\n${constraints.map(c => `- ${c}`).join('\n')}`,
    });
  }

  const hasPdf = !!args.prdFile && args.prdFile.mediaType === 'application/pdf';

  let raw: string;
  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      },
      // PDF support requires the beta header on some SDK versions
      hasPdf ? { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } } : {},
    );
    raw = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Claude API error: ${err.message}` }] };
  }

  const testCount = (raw.match(/^# test_name:/gm) ?? []).length;
  const criticalCount = (raw.match(/^# risk: critical/gm) ?? []).length;
  const highCount = (raw.match(/^# risk: high/gm) ?? []).length;

  const outputPath = args.outputFile ?? WORKSPACE_PATHS.prdTests;
  const filterNote = [
    ...(args.tier?.length ? [`# Tier filter:    ${args.tier.join(', ')}`] : []),
    ...(args.focus?.length ? [`# Feature filter: ${args.focus.join(', ')}`] : []),
  ];
  const header = [
    '# ─────────────────────────────────────────────────────────────────────────',
    `# PRD Test Analysis — ${new Date().toISOString().slice(0, 10)}`,
    ...(filterNote.length ? ['# ─────────────────────────────────────────────────────────────────────────', ...filterNote] : []),
    '# ─────────────────────────────────────────────────────────────────────────',
    '#',
    '# Review: keep the tests you want, delete the ones you don\'t.',
    '# Run:    npm run generate -- --file prd-tests.txt',
    '#',
    '# risk levels: critical | high | medium | low',
    '# ─────────────────────────────────────────────────────────────────────────',
    '',
    '',
  ].join('\n');

  await writeFile(outputPath, header + raw.trim() + '\n', 'utf-8');

  // Append to persistent gap backlog so identified gaps survive between sessions.
  // Each test_name is written as a "- name" bullet so readBacklogTestNames() can
  // load them on the next run and exclude them from Claude's "already covered" list.
  // Mark resolved by changing "- name" to "- ~~name~~" (strikethrough).
  const BACKLOG_PATH = WORKSPACE_PATHS.gapsBacklog;
  const BACKLOG_HEADER = '# Gaps Backlog\n\nGaps identified by analyze_coverage and analyze_prd that have not yet been generated.\nMark resolved with ~~strikethrough~~ or delete the line.\n\n';
  const date = new Date().toISOString().slice(0, 10);
  const sourceLabel = args.prdContent
    ? args.prdContent.slice(0, 60).replace(/\n/g, ' ').trim() + '…'
    : 'file/url input';
  // Extract test_name + spec_file pairs so each backlog entry is scannable
  const testEntries: { name: string; spec: string }[] = [];
  for (const block of raw.split(/^---$/m)) {
    const nameM = block.match(/^# test_name:\s*(.+)$/m);
    const specM = block.match(/^# spec_file:\s*(.+)$/m);
    if (nameM) testEntries.push({ name: nameM[1].trim(), spec: specM?.[1].trim() ?? '' });
  }
  const backlogSection = [
    `## ${date} — analyze_prd — ${sourceLabel} (${testCount} suggestion${testCount === 1 ? '' : 's'})`,
    '',
    `${criticalCount} critical · ${highCount} high · ${testCount - criticalCount - highCount} medium/low`,
    ...testEntries.map(e => e.spec ? `- ${e.name}  # ${e.spec}` : `- ${e.name}`),
    '',
    '---',
    '',
  ].join('\n');
  try {
    let existing = await readFile(BACKLOG_PATH, 'utf-8').catch(() => BACKLOG_HEADER);
    if (!existing.startsWith('# Gaps Backlog')) existing = BACKLOG_HEADER + existing;
    await writeFile(BACKLOG_PATH, existing.trimEnd() + '\n\n' + backlogSection, 'utf-8');
  } catch { /* non-fatal */ }

  const lines = [
    `✅ ${testCount} test suggestion${testCount === 1 ? '' : 's'} written to prd-tests.txt`,
    `   ${criticalCount} critical  ${highCount} high  ${testCount - criticalCount - highCount} medium/low`,
    `   Backlog entry appended to: GAPS_BACKLOG.md`,
    '',
    'Review the file, remove what you don\'t want, then run:',
    '  npm run generate -- --file prd-tests.txt',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
