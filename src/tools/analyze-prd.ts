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
# page_paths: /path1, /path2
# risk: critical|high|medium|low
# reason: One sentence explaining why this risk level applies.

Plain description or numbered steps of what the test does and asserts.
Be specific enough that a developer can implement it without reading the PRD.

---

## Rules
- test_name must be unique, lowercase, hyphen-separated
- page_paths should list every page the test navigates to on automationexercise.com
- Generate the happy path AND the most important negative/edge cases as separate blocks
- Do NOT suggest tests already in the covered list — only genuinely new scenarios
- Order output: critical first, then high, medium, low
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

export async function analyzePrdTool(args: {
  prdContent: string;
  outputFile?: string;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY is not set.' }] };
  }

  // Load existing coverage so the tool only suggests what's missing
  let coverageList = 'Could not read existing coverage.';
  try {
    const [passing, broken] = await Promise.all([readTestCases(), readBrokenTests()]);
    coverageList = buildCoverageList(passing, broken);
  } catch { /* proceed without coverage */ }

  const client = new Anthropic({ apiKey });

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `${coverageList}\n\n---\n\n## PRD to analyse\n\n${args.prdContent}`,
      }],
    });
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
  const header = [
    '# ─────────────────────────────────────────────────────────────────────────',
    `# PRD Test Analysis — ${new Date().toISOString().slice(0, 10)}`,
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
