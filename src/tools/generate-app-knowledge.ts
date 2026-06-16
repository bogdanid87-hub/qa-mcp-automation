import { WORKSPACE_PATHS, ensureWorkspace } from '../workspace.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { safeWrite } from '../lib/safe-write.js';
import {
  readBrokenTests,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
} from './test-registry.js';
import { errorContent } from '../lib/format-error.js';
import { config } from '../config.js';

const ROOT = process.cwd();
const MODEL = config.models.primary;
export const APP_KNOWLEDGE_PATH = WORKSPACE_PATHS.appKnowledge;
export const APP_KNOWLEDGE_MANUAL_PATH = WORKSPACE_PATHS.appKnowledgeManual;
export const APP_KNOWLEDGE_CANDIDATES_PATH = WORKSPACE_PATHS.appKnowledgeCandidates;
export const APP_LIMITATIONS_PATH = join(ROOT, 'APP_LIMITATIONS.md');
const GAPS_BACKLOG_PATH = WORKSPACE_PATHS.gapsBacklog;
const COVERAGE_REPORT_PATH = WORKSPACE_PATHS.coverageReport;

// ── Data gathering ─────────────────────────────────────────────────────────────

async function gatherContext(): Promise<{
  appBugs: string;
  openGaps: string;
  coverageSummary: string;
}> {
  // App bugs from all registries
  const [ui, api, e2e, visual] = await Promise.all([
    readBrokenTests(TESTS_UI_PATH),
    readBrokenTests(TESTS_API_PATH),
    readBrokenTests(TESTS_E2E_PATH),
    readBrokenTests(TESTS_VISUAL_PATH),
  ]);
  const allBugs = [...ui, ...api, ...e2e, ...visual].filter(e => e.kind === 'app_bug');

  const appBugs = allBugs.length === 0
    ? '(none recorded)'
    : allBugs.map(b =>
        `- [${b.spec}] ${b.describe} › ${b.name}\n  Root cause: ${b.rootCause}\n  Actual behaviour: ${b.actualBehavior ?? 'see root cause'}`
      ).join('\n');

  // Open gaps from backlog
  let openGaps = '(no backlog file found)';
  try {
    const backlog = await readFile(GAPS_BACKLOG_PATH, 'utf-8');
    // Extract non-resolved entries (no ✅ in priority or ~~text~~ in name)
    const lines = backlog.split('\n');
    const gapLines: string[] = [];
    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      if (line.includes('Priority') || /^[-: ]+$/.test(line.replace(/\|/g, '').trim())) continue;
      if (line.includes('✅') || line.includes('~~')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length >= 2 && cells[0] && cells[1]) {
        gapLines.push(`- [${cells[0]}] ${cells[1]}`);
      }
    }
    openGaps = gapLines.length === 0 ? '(no open gaps)' : gapLines.join('\n');
  } catch { /* file doesn't exist */ }

  // Key findings from last coverage report (first 2000 chars to keep context tight)
  let coverageSummary = '(no coverage report found — run npm run analyze_coverage first)';
  try {
    const report = await readFile(COVERAGE_REPORT_PATH, 'utf-8');
    coverageSummary = report.slice(0, 2000) + (report.length > 2000 ? '\n...(truncated)' : '');
  } catch { /* file doesn't exist */ }

  return { appBugs, openGaps, coverageSummary };
}

// ── Synthesis prompt ───────────────────────────────────────────────────────────

const SYNTHESIS_PROMPT = (ctx: Awaited<ReturnType<typeof gatherContext>>) => `\
You are a QA analyst synthesising accumulated knowledge about a web application
into a structured risk knowledge base. This document will be used to enrich future
PRD analysis and coverage gap analysis by giving Claude context about the app's
known problem areas.

## Known application bugs (tests that correctly document site defects)
${ctx.appBugs}

## Open coverage gaps (test cases identified but not yet written)
${ctx.openGaps}

## Last coverage report summary
${ctx.coverageSummary}

---

Generate APP_KNOWLEDGE.md in this exact format. Group by feature area.
For each area: summarise risk level, list known app bugs, list open gaps,
and add a "Notes" line with any patterns or warnings for future analysis.
Be concise and specific — this is a working reference document, not a report.

Output raw Markdown only (no fences, no preamble):

# App Knowledge Base

_Auto-generated — human-editable. Re-run \`npm run generate_knowledge\` to refresh._
_Last updated: ${new Date().toISOString().slice(0, 10)}_

---

[one section per feature area in this format:]

## [Feature area name]
**Risk level:** critical | high | medium | low
**App bugs:** [bullet list, or "none"]
**Open gaps:** [bullet list, or "none"]
**Notes:** [one sentence of key patterns or warnings for future PRD/coverage analysis]

`;

// ── Main tool ──────────────────────────────────────────────────────────────────

export async function generateAppKnowledgeTool(args: {
  output?: string;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  await ensureWorkspace();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return errorContent('Error: ANTHROPIC_API_KEY not set.', { category: 'config', tool: 'generate_app_knowledge' });

  const outputPath = args.output ?? APP_KNOWLEDGE_PATH;

  process.stdout.write('  Reading registries, backlog, and coverage report...\n');
  const ctx = await gatherContext();

  process.stdout.write('  Synthesising with Claude...\n');
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: SYNTHESIS_PROMPT(ctx) }],
  });

  const synthesised = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  // Append manual notes sidecar if it exists — never overwritten by this tool
  let manualContent = '';
  try {
    manualContent = await readFile(APP_KNOWLEDGE_MANUAL_PATH, 'utf-8');
  } catch { /* no sidecar yet */ }

  const finalContent = manualContent.trim()
    ? synthesised + '\n\n---\n\n' + manualContent.trim() + '\n'
    : synthesised + '\n';

  await safeWrite(outputPath, finalContent, { allowOverwrite: true });

  const bugCount = ctx.appBugs === '(none recorded)' ? 0
    : ctx.appBugs.split('\n- [').length;
  const gapCount = ctx.openGaps === '(no open gaps)' || ctx.openGaps === '(no backlog file found)' ? 0
    : ctx.openGaps.split('\n- [').length;

  return {
    content: [{
      type: 'text',
      text: [
        `✅ APP_KNOWLEDGE.md generated`,
        `   Sources: ${bugCount} app bug(s), ${gapCount} open gap(s), coverage report`,
        ...(manualContent.trim() ? [`   Manual notes: APP_KNOWLEDGE_MANUAL.md appended`] : [`   Tip: add permanent notes to APP_KNOWLEDGE_MANUAL.md — never overwritten`]),
        `   Written to: ${outputPath}`,
        ``,
        `Feed into analysis:`,
        `   npm run analyze_prd -- --file prd.md     (reads APP_KNOWLEDGE.md automatically)`,
        `   npm run analyze_coverage                 (reads APP_KNOWLEDGE.md automatically)`,
      ].join('\n'),
    }],
  };
}

/** Read the knowledge base content for injection into other tools' prompts. */
export async function readAppKnowledge(): Promise<string> {
  try {
    return await readFile(APP_KNOWLEDGE_PATH, 'utf-8');
  } catch {
    return '';
  }
}

/** Read the app limitations file for injection into generator and analysis prompts. */
export async function readAppLimitations(): Promise<string> {
  try {
    return await readFile(APP_LIMITATIONS_PATH, 'utf-8');
  } catch {
    return '';
  }
}

// ── App knowledge candidates ─────────────────────────────────────────────────

export interface KnowledgeCandidate {
  area: string;
  note: string;
}

const CANDIDATES_HEADER = `# App Knowledge Candidates

Observations from \`analyze_coverage\` / \`audit_site\` that may be worth promoting
into \`APP_KNOWLEDGE_MANUAL.md\` (durable app-behavior knowledge, picked up by the
next \`generate_app_knowledge\` run) or \`APP_LIMITATIONS.md\` (missing features — edit
by hand). Not read by any tool. Review periodically and delete entries once promoted
or dismissed.

`;

/**
 * Format one dated section for a source (e.g. "analyze_coverage — <scope>" or
 * "audit_site — <url> (structure|data)"). Pure — no file I/O.
 */
export function buildCandidatesSection(candidates: KnowledgeCandidate[], source: string, date: string): string {
  const items = candidates.map(c => `- **${c.area}**: ${c.note}`).join('\n');
  return [`## ${date} — ${source}`, '', items, '', '---', ''].join('\n');
}

/**
 * Replace an existing section for the same `source`, or append. Mirrors
 * analyze-coverage.ts's appendToGapsBacklog regex-replace pattern. Pure — no file I/O.
 */
export function mergeCandidatesSection(existing: string, section: string, source: string): string {
  const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingSection = new RegExp(`## [^\\n]+ — ${escapedSource}\\n[\\s\\S]*?---\\n`);
  return existingSection.test(existing)
    ? existing.replace(existingSection, section)
    : existing.trimEnd() + '\n\n' + section;
}

/**
 * Append candidate APP_KNOWLEDGE entries from analyze_coverage / audit_site to
 * APP_KNOWLEDGE_CANDIDATES.md for human review. Replaces any existing section for
 * the same `source`. No-op when `candidates` is empty.
 */
export async function appendKnowledgeCandidates(candidates: KnowledgeCandidate[], source: string, date: string): Promise<void> {
  if (candidates.length === 0) return;
  let existing: string;
  try {
    existing = await readFile(APP_KNOWLEDGE_CANDIDATES_PATH, 'utf-8');
  } catch {
    existing = CANDIDATES_HEADER;
  }
  if (!existing.startsWith('# App Knowledge Candidates')) existing = CANDIDATES_HEADER + existing;
  const section = buildCandidatesSection(candidates, source, date);
  await safeWrite(APP_KNOWLEDGE_CANDIDATES_PATH, mergeCandidatesSection(existing, section, source), { allowOverwrite: true });
}
