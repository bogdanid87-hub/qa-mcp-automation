import Anthropic from '@anthropic-ai/sdk';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { readTestCases, readBrokenTests } from './test-registry.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `\
You are a QA analyst for automationexercise.com, a practice e-commerce website.

Given a PRD (or feature description), identify every feature or user flow, classify
it by risk, and output test case suggestions in a structured file format.

## Risk levels

critical — Direct revenue impact. Failure prevents purchases or causes financial errors.
           Examples: checkout, payment, cart totals, order confirmation.

high     — Trust or data integrity. Failure erodes confidence or surfaces wrong data.
           Examples: login/registration, account management, order history, pricing accuracy.

medium   — Conversion impact. Failure reduces purchase likelihood without blocking it.
           Examples: product search, filtering, navigation, product detail accuracy.

low      — Minor UX or content. Rarely causes abandonment.
           Examples: static pages, newsletter, social links, error pages.

## Output format

Output ONLY test blocks — no preamble, no prose outside the blocks, no markdown fences.
Separate every block with a line containing exactly three dashes: ---

Each block must follow this exact structure:

# test_name: kebab-case-descriptive-name
# spec_file: tests/ui/feature.spec.ts
# page_paths: /path1, /path2
# source: direct|suggested
# risk: critical|high|medium|low
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
   - If the source document contains numbered items (e.g. "API 1:", "API 2:", "Test Case 3:",
     "US-01:"), preserve that numbering order exactly. Do NOT re-sort by risk.
   - If the source has no inherent numbering, order by risk: critical → high → medium → low.

3. Within the suggested group: always order by risk: critical → high → medium → low.
   Suggested tests never follow source numbering because they are not derived from a
   specific numbered item.

## Other rules
- test_name must be unique, lowercase, hyphen-separated
- page_paths should list every page the test navigates to on automationexercise.com
- Generate the happy path AND the most important negative/edge cases as separate blocks
- Do NOT suggest tests already in the covered list — only genuinely new scenarios
- For each feature generate 2–4 blocks (happy path + key failure cases), not just one
- Keep descriptions concrete: what action, what assertion, what data
`;

function buildCoverageList(
  passing: Awaited<ReturnType<typeof readTestCases>>,
  broken: Awaited<ReturnType<typeof readBrokenTests>>,
): string {
  const all = [
    ...passing.map(t => `${t.describe} › ${t.name}`),
    ...broken.map(t => `${t.describe} › ${t.name}`),
  ];
  if (all.length === 0) return 'No existing test coverage.';
  return `Already covered — do NOT suggest tests for these:\n${all.map(n => `- ${n}`).join('\n')}`;
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
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY is not set.' }] };
  }
  if (!args.prdContent && !args.prdFile) {
    return { content: [{ type: 'text', text: 'Error: provide either prdContent (text) or prdFile (PDF/image).' }] };
  }

  // Load existing coverage so the tool only suggests what's missing
  let coverageList = 'Could not read existing coverage.';
  try {
    const [passing, broken] = await Promise.all([readTestCases(), readBrokenTests()]);
    coverageList = buildCoverageList(passing, broken);
  } catch { /* proceed without coverage */ }

  const client = new Anthropic({ apiKey });

  // Build the user message content — text first, then document (PDF), then images.
  // Claude reads all provided media before generating suggestions.
  const userContent: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: coverageList + '\n\n---\n\n## PRD to analyse' +
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

  const outputPath = args.outputFile ?? join(ROOT, 'prd-tests.txt');
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

  const lines = [
    `✅ ${testCount} test suggestion${testCount === 1 ? '' : 's'} written to prd-tests.txt`,
    `   ${criticalCount} critical  ${highCount} high  ${testCount - criticalCount - highCount} medium/low`,
    '',
    'Review the file, remove what you don\'t want, then run:',
    '  npm run generate -- --file prd-tests.txt',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
