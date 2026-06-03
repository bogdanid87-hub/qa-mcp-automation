import Anthropic from '@anthropic-ai/sdk';
import { readFile, readdir, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { readTestCases, readBrokenTests, TESTS_UI_PATH, TESTS_API_PATH, TESTS_E2E_PATH, registryForSpec } from './test-registry.js';
import { readAppKnowledge } from './generate-app-knowledge.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';
const SITE_HOST = 'automationexercise.com';

// ── Context gathering ──────────────────────────────────────────────────────────

/** Read a single spec file or all spec files in a directory. */
async function readSpecContext(specPath: string): Promise<string> {
  const abs = join(ROOT, specPath);
  try {
    const content = await readFile(abs, 'utf-8');
    return `### ${specPath}\n\`\`\`typescript\n${content}\n\`\`\``;
  } catch {
    // Try as directory
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      const parts: string[] = [];
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.spec.ts')) {
          const fc = await readFile(join(abs, e.name), 'utf-8').catch(() => '');
          if (fc) parts.push(`### ${specPath}/${e.name}\n\`\`\`typescript\n${fc}\n\`\`\``);
        }
      }
      return parts.join('\n\n');
    } catch {
      return `(could not read ${specPath})`;
    }
  }
}

/** Read the full registry file. */
async function readRegistryContext(registryPath: string): Promise<string> {
  try {
    return await readFile(registryPath, 'utf-8');
  } catch {
    return '(registry file not found)';
  }
}

/**
 * Extract only the section for a specific spec file from a registry.
 * This keeps the context focused when analysing a single spec.
 */
function extractRegistrySection(content: string, specPath: string): string {
  const header = `## ${specPath}`;
  const start = content.indexOf(header);
  if (start === -1) return `(no registry entries found for ${specPath} — it may not have passed tests yet)`;

  // Section ends at the next ## header (another spec or a broken/app-bug section)
  const rest = content.slice(start + header.length);
  const nextSection = rest.search(/\n## /);
  const body = nextSection === -1 ? rest : rest.slice(0, nextSection);
  return `${header}${body}`.trim();
}

/** Fetch a URL — uses inspect_page DOM extraction for the test site, plain text for docs. */
async function fetchUrlContext(url: string): Promise<string> {
  const isSite = new URL(url).hostname.includes(SITE_HOST);

  if (isSite) {
    // Rich DOM extraction — gives data-qa attributes, inputs, buttons, links
    try {
      const path = new URL(url).pathname;
      const snapshots = await inspectPages([path]);
      return `## Live page inspection: ${url}\n\n${formatSnapshots(snapshots)}`;
    } catch (err: any) {
      return `(inspect_page failed for ${url}: ${err.message})`;
    }
  } else {
    // External docs page — plain text extraction
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const text = await page.evaluate(() => document.body.innerText);
      return `## Page content: ${url}\n\n${text.trim()}`;
    } catch (err: any) {
      return `(could not fetch ${url}: ${err.message})`;
    } finally {
      await browser.close();
    }
  }
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a QA coverage analyst for automationexercise.com.

Given the existing test suite context (spec files, registry state) and optional
page/feature information, identify coverage gaps and risk areas.

## Analysis goals
1. What is currently tested and how thoroughly
2. What is missing — by feature, by test type (no negative tests, no edge cases), or by flow
3. Risk and priority for each gap — see definitions below
4. Specific, actionable descriptions for each gap

## Risk — the intrinsic criticality of the FEATURE being tested
critical — Revenue impact: checkout, payment, cart totals, order confirmation
high     — Trust/data: login, registration, account management, order history
medium   — Conversion: search, filtering, navigation, product accuracy
low      — Content/UX: static pages, newsletter, social links

## Priority — the urgency to WRITE THIS TEST (may differ from risk)
Priority can be higher than risk when:
- The gap covers the DOMINANT user path while only an optional variant is tested.
  Example: a contact form always tested WITH a file attachment → no-file gap is
  medium priority even though the feature is low risk, because most users don't
  attach files. The untested path affects the majority of real usage.
- The gap is the ONLY test for a given flow (any failure means zero coverage).
- A regression in this path would be invisible to the test suite.
Priority should match risk when there is no such amplifying factor.

## Source field
direct    — gap for a path or variant that visibly exists in the spec/app
suggested — gap from testing best practices (negative case, edge case, boundary)

## Note field (optional)
Include a note when priority diverges from risk, or when there is something
unusual about this gap that the developer should know before implementing.
Omit it when the gap is straightforward.

## Output format — raw JSON only, no markdown fences:
{
  "summary": "2-3 sentence overall assessment of coverage quality and key concerns",
  "covered_well": ["brief list of areas with good coverage"],
  "covered_partially": ["areas with some coverage but gaps"],
  "gaps": [
    {
      "test_name": "kebab-case-descriptive-name",
      "spec_file": "tests/ui/feature.spec.ts",
      "source": "direct|suggested",
      "risk": "critical|high|medium|low",
      "priority": "critical|high|medium|low",
      "note": "optional — only include when priority differs from risk or there is unusual context",
      "reason": "one sentence explaining why this gap matters",
      "description": "what the test does and asserts — specific enough to implement"
    }
  ],
  "priority_summary": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
  "recommendations": "2-3 prioritised next steps"
}
`;

// ── Report builder ─────────────────────────────────────────────────────────────

interface Gap {
  test_name: string;
  spec_file: string;
  source: string;
  risk: string;
  priority: string;
  note?: string;
  reason: string;
  description: string;
}

interface CoverageResult {
  summary: string;
  covered_well: string[];
  covered_partially: string[];
  gaps: Gap[];
  priority_summary: Record<string, number>;
  recommendations: string;
}

function buildReport(result: CoverageResult, contextLabel: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const total = result.gaps.length;
  const { critical = 0, high = 0, medium = 0, low = 0 } = result.priority_summary;

  const lines: string[] = [
    `# Coverage Analysis Report`,
    `Generated: ${date}  |  Scope: ${contextLabel}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    result.summary,
    '',
    '---',
    '',
    '## Coverage state',
    '',
    '**Well covered:**',
    ...result.covered_well.map(s => `- ${s}`),
    '',
    '**Partially covered:**',
    ...result.covered_partially.map(s => `- ${s}`),
    '',
    '---',
    '',
    `## Gaps found — ${total} total by priority (${critical} critical · ${high} high · ${medium} medium · ${low} low)`,
    '',
    '> **Priority** = urgency to write the test. **Risk** = intrinsic feature criticality.',
    '> These differ when the dominant user path is untested or coverage is zero for a flow.',
    '',
  ];

  // Sort and display by priority (not risk)
  for (const tier of ['critical', 'high', 'medium', 'low']) {
    const inTier = result.gaps.filter(g => (g.priority ?? g.risk) === tier);
    if (inTier.length === 0) continue;
    lines.push(`### Priority: ${tier.charAt(0).toUpperCase() + tier.slice(1)} (${inTier.length})`, '');
    for (const g of inTier) {
      const riskLabel = g.risk !== (g.priority ?? g.risk) ? ` | risk: ${g.risk}` : '';
      lines.push(`**${g.test_name}** — \`${g.spec_file}\`  [${g.source}${riskLabel}]`);
      lines.push(`*${g.reason}*`);
      if (g.note) lines.push(`> ℹ️ ${g.note}`);
      lines.push('');
      lines.push(g.description);
      lines.push('');
    }
  }

  lines.push('---', '', '## Recommendations', '', result.recommendations, '');
  return lines.join('\n');
}

function buildGapsFile(result: CoverageResult, contextLabel: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const header = [
    `# ─────────────────────────────────────────────────────────────────────────`,
    `# Coverage Gaps — ${date}  |  Scope: ${contextLabel}`,
    `# ─────────────────────────────────────────────────────────────────────────`,
    `#`,
    `# Review: keep the tests you want, delete the ones you don't.`,
    `# Run:    npm run generate -- --file coverage-gaps.txt`,
    `#`,
    `# ─────────────────────────────────────────────────────────────────────────`,
    '',
    '',
  ].join('\n');

  // Sort gaps file by priority (matching the report order)
  const tierOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...result.gaps].sort(
    (a, b) => (tierOrder[a.priority ?? a.risk] ?? 3) - (tierOrder[b.priority ?? b.risk] ?? 3),
  );

  const blocks = sorted.map(g => {
    const lines = [
      `# test_name: ${g.test_name}`,
      `# spec_file: ${g.spec_file}`,
      `# source: ${g.source}`,
      `# priority: ${g.priority ?? g.risk}`,
      `# risk: ${g.risk}`,
      `# reason: ${g.reason}`,
    ];
    if (g.note) lines.push(`# note: ${g.note}`);
    lines.push('', g.description);
    return lines.join('\n');
  });

  return header + blocks.join('\n\n---\n\n') + '\n';
}

// ── Deep analysis (option 4) ───────────────────────────────────────────────────

/**
 * Pre-analysis pass: ask Claude to enumerate which paths, variants, and
 * scenarios are NOT exercised by the existing tests before the main analysis.
 * The output becomes additional context for the main call, improving accuracy
 * of gap detection and priority assignment.
 */
async function analyzeUntestedPaths(specContent: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system:
      'You are a Playwright test analyst. Given a spec file, enumerate which ' +
      'paths, variants, input types, and error states are NOT exercised by the ' +
      'existing tests. Be specific and concise — list only what is absent, not ' +
      'what is present. Focus on paths a real user would actually follow.',
    messages: [{
      role: 'user',
      content: `Analyse this spec and list what is NOT tested:\n\n${specContent}`,
    }],
  });
  return msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
}

// ── Gaps backlog ───────────────────────────────────────────────────────────────

const BACKLOG_PATH = join(ROOT, 'GAPS_BACKLOG.md');

const BACKLOG_HEADER = `# Gaps Backlog

Gaps identified by analyze_coverage and analyze_prd that have not yet been generated.
Delete rows or mark ✅ when addressed.

`;

/**
 * Write or replace an entry in GAPS_BACKLOG.md for the given scope.
 * If an entry for the same tool + scope already exists, it is replaced in-place
 * (date is updated, gaps are refreshed). Otherwise a new section is appended.
 * This prevents duplicate entries when the same scope is analysed multiple times.
 */
async function appendToGapsBacklog(gaps: Gap[], contextLabel: string, date: string): Promise<void> {
  let existing = '';
  try { existing = await readFile(BACKLOG_PATH, 'utf-8'); } catch { existing = BACKLOG_HEADER; }
  if (!existing.startsWith('# Gaps Backlog')) existing = BACKLOG_HEADER + existing;

  const rows = gaps.map(g =>
    `| ${g.priority ?? g.risk} | ${g.test_name} | \`${g.spec_file}\` | ${g.source} |`
  ).join('\n');

  const section = [
    `## ${date} — analyze_coverage — ${contextLabel} (${gaps.length} gap${gaps.length === 1 ? '' : 's'})`,
    '',
    '| Priority | Test name | Spec | Source |',
    '|----------|-----------|------|--------|',
    rows,
    '',
    '---',
    '',
  ].join('\n');

  // Replace existing entry for same scope, or append if new
  const escapedLabel = contextLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingSection = new RegExp(
    `## [^\n]+ — analyze_coverage — ${escapedLabel}[^\n]*\n[\\s\\S]*?---\n`,
  );

  const updated = existingSection.test(existing)
    ? existing.replace(existingSection, section)
    : existing.trimEnd() + '\n\n' + section;

  await writeFile(BACKLOG_PATH, updated, 'utf-8');
}

/**
 * Mark backlog rows as ✅ when tests with matching names are now passing.
 * Uses normalised comparison (lowercase, strip punctuation) so kebab-case gap
 * names match the sentence-case test names recorded in the registry.
 * Exported so sync_registry can call it after recording passing tests.
 */
export async function markBacklogEntriesCovered(passingTestNames: string[]): Promise<number> {
  let content: string;
  try { content = await readFile(BACKLOG_PATH, 'utf-8'); } catch { return 0; }

  const norm = (s: string) => s.toLowerCase().replace(/[-\s\W]+/g, '');
  const covered = new Set(passingTestNames.map(norm));

  // Match table data rows (not header/separator rows)
  const updated = content.replace(
    /^\| ([^|\n]+) \| ([^|\n]+) \| (`[^|\n]+`) \| ([^|\n]+) \|$/gm,
    (line, priority, testName, spec, source) => {
      if (testName.includes('✅')) return line; // already marked
      if (covered.has(norm(testName.trim()))) {
        return `| ✅ | ~~${testName.trim()}~~ | ${spec.trim()} | ${source.trim()} |`;
      }
      return line;
    },
  );

  if (updated !== content) await writeFile(BACKLOG_PATH, updated, 'utf-8');
  return (updated.match(/✅/g) ?? []).length - (content.match(/✅/g) ?? []).length;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function analyzeCoverageTool(args: {
  specPath?: string;      // e.g. 'tests/ui/contact.spec.ts' or 'tests/ui/'
  registryPath?: string;  // e.g. 'TESTS_UI.md'
  url?: string;           // optional feature context
  generateGaps?: boolean; // write coverage-gaps.txt
  deep?: boolean;         // run pre-analysis pass to identify untested paths
  outputDir?: string;     // defaults to ROOT
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY is not set.' }] };
  }

  // ── Gather context ───────────────────────────────────────────────────────────
  const contextParts: string[] = [];
  const labels: string[] = [];

  // Include app knowledge base if it exists — gives Claude context about known
  // bugs and risk patterns so gaps are prioritised against real app behaviour.
  const appKnowledge = await readAppKnowledge();
  if (appKnowledge) {
    contextParts.push(`## App knowledge base (known bugs, risk patterns)\n\n${appKnowledge}`);
  }

  // True when a single spec file is given (not a folder or registry)
  const isSingleSpec = !!args.specPath && args.specPath.endsWith('.spec.ts');

  if (args.specPath) {
    const specCtx = await readSpecContext(args.specPath);
    contextParts.push(`## Existing spec files\n\n${specCtx}`);

    const regPath = registryForSpec(args.specPath);
    const fullReg = await readRegistryContext(regPath);

    // Single spec → extract only its registry section to keep focus tight
    const regCtx = isSingleSpec
      ? extractRegistrySection(fullReg, args.specPath)
      : fullReg;

    contextParts.push(`## Registry state\n\n${regCtx}`);
    labels.push(args.specPath);
  } else if (args.registryPath) {
    const regCtx = await readRegistryContext(join(ROOT, args.registryPath));
    contextParts.push(`## Registry state\n\n${regCtx}`);
    labels.push(args.registryPath);
  } else {
    // All registries — brief overview
    const [ui, api, e2e] = await Promise.all([
      readRegistryContext(TESTS_UI_PATH),
      readRegistryContext(TESTS_API_PATH),
      readRegistryContext(TESTS_E2E_PATH),
    ]);
    contextParts.push(`## TESTS_UI.md\n\n${ui}\n\n## TESTS_API.md\n\n${api}\n\n## TESTS_E2E.md\n\n${e2e}`);
    labels.push('all registries');
  }

  if (args.url) {
    const urlCtx = await fetchUrlContext(args.url);
    contextParts.push(urlCtx);
    labels.push(args.url);
  }

  const contextLabel = labels.join(' + ');

  // When scoped to a single spec, explicitly prevent whole-app analysis
  const scopingInstruction = isSingleSpec
    ? `\n\n**Scope constraint:** Analyse gaps ONLY for the feature tested by "${args.specPath}". ` +
      `Do not report gaps for other features, pages, or flows of the application. ` +
      `All gaps in your response must be directly related to the functionality shown in the spec above.`
    : '';

  // ── Deep mode: pre-analysis pass to identify untested paths (option 4) ───────
  if (args.deep && args.specPath) {
    process.stdout.write('  Running deep path analysis (pre-pass)...\n');
    const section = contextParts.find(p => p.startsWith('## Existing spec'));
    const specContent = section ? section.slice(section.indexOf('\n') + 1).trim() : '';
    if (specContent) {
      try {
        const untestedPaths = await analyzeUntestedPaths(specContent, apiKey);
        contextParts.push(`## Pre-analysis: untested paths identified\n\n${untestedPaths}`);
      } catch (err) {
        process.stdout.write(`  ⚠️  Deep pre-pass failed (${(err as Error).message}) — continuing with single-pass analysis.\n`);
      }
    }
  }

  const userMessage = contextParts.join('\n\n---\n\n') + scopingInstruction +
    '\n\nBased on the above context, identify coverage gaps and risk areas.';

  // ── Call Claude ──────────────────────────────────────────────────────────────
  const client = new Anthropic({ apiKey });
  let raw: string;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    raw = msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Claude API error: ${err.message}` }] };
  }

  // ── Parse ────────────────────────────────────────────────────────────────────
  let result: CoverageResult;
  try {
    const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const jsonStr = (() => {
      try { JSON.parse(stripped); return stripped; } catch { /* */ }
      const lineStart = stripped.search(/(?:^|\n)\s*\{/);
      const s = lineStart !== -1 ? stripped.indexOf('{', lineStart) : stripped.indexOf('{');
      const e = stripped.lastIndexOf('}');
      if (s !== -1 && e > s) return stripped.slice(s, e + 1);
      throw new Error('No JSON found');
    })();
    result = JSON.parse(jsonStr);
  } catch {
    return { content: [{ type: 'text', text: `Claude returned invalid JSON.\n\n${raw}` }] };
  }

  // ── Write outputs ────────────────────────────────────────────────────────────
  const outDir = args.outputDir ?? ROOT;
  const reportPath = join(outDir, 'coverage-report.md');
  const report = buildReport(result, contextLabel);
  await writeFile(reportPath, report, 'utf-8');

  const { critical = 0, high = 0, medium = 0, low = 0 } = result.priority_summary;
  const total = result.gaps.length;
  const lines = [
    `✅ Coverage analysis complete — ${total} gap${total === 1 ? '' : 's'} found`,
    `   ${critical} critical  ${high} high  ${medium} medium  ${low} low`,
    '',
    `Report written to: coverage-report.md`,
  ];

  if (args.generateGaps && total > 0) {
    const gapsPath = join(outDir, 'coverage-gaps.txt');
    await writeFile(gapsPath, buildGapsFile(result, contextLabel), 'utf-8');
    await appendToGapsBacklog(result.gaps, contextLabel, new Date().toISOString().slice(0, 10));
    lines.push(`Gaps file written to: coverage-gaps.txt`);
    lines.push(`Backlog entry appended to: GAPS_BACKLOG.md`);
    lines.push(`Run: npm run generate -- --file coverage-gaps.txt`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
