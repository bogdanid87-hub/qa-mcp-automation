import { readFile } from 'fs/promises';
import { join } from 'path';
import { readTestCases, TESTS_UI_PATH, TESTS_API_PATH, TESTS_E2E_PATH, extractReqIds } from './test-registry.js';

/**
 * Requirements traceability ledger (REQUIREMENTS.md) — maps stable REQ IDs
 * assigned by analyze_prd back to a one-line description of the requirement
 * they trace to in the source PRD. Resolved against the consuming project's
 * root, mirroring learned-rules.md (2.4) — each project's ledger lives in its
 * own repo, not inside this package.
 */

export interface RequirementEntry {
  id: string;
  text: string;
}

export const REQUIREMENTS_PATH = join(process.cwd(), 'REQUIREMENTS.md');

export const REQUIREMENTS_TEMPLATE = `# Requirements

Traceability ledger — maps REQ IDs assigned by analyze_prd back to the requirement
they trace to in the source PRD. Append-only: each ID is permanent once assigned —
do not renumber or remove existing entries. Descriptions may be edited for clarity.

<!-- requirements-start -->
<!-- requirements-end -->
`;

// Prefixes that don't add information beyond "this is a requirement" — folded
// into a plain REQ-NNN id instead of REQ-REQ-NNN / REQ-REQUIREMENT-NNN.
const GENERIC_PREFIXES = new Set(['REQ', 'REQUIREMENT']);

/**
 * Extract the content between the <!-- requirements-start --> /
 * <!-- requirements-end --> markers, mirroring system.ts's
 * extractRulesSection for learned-rules.md.
 */
function extractRequirementsSection(content: string): string {
  const match = content.match(/<!-- requirements-start -->([\s\S]*?)<!-- requirements-end -->/);
  return match ? match[1].trim() : '';
}

/** Parse "- REQ-ID: text" entries from REQUIREMENTS.md content. */
export function parseRequirements(content: string): RequirementEntry[] {
  const section = extractRequirementsSection(content);
  const entries: RequirementEntry[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^- (REQ-[A-Z0-9-]+):\s*(.+)$/);
    if (m) entries.push({ id: m[1], text: m[2].trim() });
  }
  return entries;
}

/**
 * Append new entries inside the <!-- requirements-start/end --> markers,
 * skipping any whose id already exists. Pure — no file I/O.
 */
export function appendRequirements(content: string, newEntries: RequirementEntry[]): string {
  const existingIds = new Set(parseRequirements(content).map(e => e.id));
  const toAdd = newEntries.filter(e => !existingIds.has(e.id));
  if (toAdd.length === 0) return content;

  const lines = toAdd.map(e => `- ${e.id}: ${e.text}`).join('\n');
  if (!content.includes('<!-- requirements-end -->')) {
    return `${content.trim()}\n\n<!-- requirements-start -->\n${lines}\n<!-- requirements-end -->\n`;
  }
  return content.replace('<!-- requirements-end -->', `${lines}\n<!-- requirements-end -->`);
}

/**
 * Normalize a PRD's numbering label into a stable REQ ID:
 *   "API 5"        -> "REQ-API-005"
 *   "API 05"       -> "REQ-API-005"   (collapses to the same id as "API 5")
 *   "Req-4"        -> "REQ-004"       (REQ/REQUIREMENT are generic prefixes)
 *   "US-01"        -> "REQ-US-001"
 *   "Test Case 12" -> "REQ-CASE-012"  (last letter-run before the digits)
 *   "5"            -> "REQ-005"
 *   "none" / "" / no digits -> null   (no req_id assigned)
 */
export function normalizeReqId(sourceRef: string): string | null {
  const trimmed = sourceRef.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return null;

  if (/^\d+$/.test(trimmed)) {
    return `REQ-${trimmed.padStart(3, '0')}`;
  }

  const m = trimmed.match(/([A-Za-z]+)\s*-?\s*(\d+)/);
  if (!m) return null;

  const prefix = m[1].toUpperCase();
  const padded = m[2].padStart(3, '0');
  return GENERIC_PREFIXES.has(prefix) ? `REQ-${padded}` : `REQ-${prefix}-${padded}`;
}

/** Read "# source_ref: ..." from a block; defaults to 'none' if absent. */
export function extractSourceRef(block: string): string {
  const m = block.match(/^# source_ref:\s*(.+)$/m);
  return m ? m[1].trim() : 'none';
}

/**
 * Insert "# req_id: REQ-..." (or "# req_id: none") right after the
 * "# source_ref:" line, or at the top of the block if that line is absent.
 */
export function injectReqId(block: string, reqId: string | null): string {
  const line = `# req_id: ${reqId ?? 'none'}`;
  if (/^# source_ref:.*$/m.test(block)) {
    return block.replace(/^(# source_ref:.*)$/m, `$1\n${line}`);
  }
  return `${line}\n${block}`;
}

/**
 * First non-empty, non-"#" line of the block — the description prose —
 * truncated to ~140 chars. Becomes the ledger's requirement description.
 */
export function extractRequirementText(block: string): string {
  const descLine = block.split('\n').find(l => l.trim() && !l.trim().startsWith('#'));
  const text = (descLine ?? '').trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

/**
 * Build the "Requirement hint" line for generate_test's prompt, or '' when no
 * req_id is provided (undefined, empty, or the literal "none" written by
 * analyze_prd for unnumbered/suggested blocks).
 */
export function formatReqHint(reqId?: string): string {
  if (!reqId || reqId.toLowerCase() === 'none') return '';
  return `Requirement hint: tag this test with @req:${reqId} — append it to the ` +
    `test name after any @smoke/@regression/@critical tags.`;
}

export interface AssignReqIdsResult {
  rawText: string;
  updatedRequirementsContent: string;
  newEntries: RequirementEntry[];
}

/**
 * Splits rawText into "---"-separated blocks, computes/injects a req_id per
 * block (first-wins dedup against requirementsContent and entries assigned
 * earlier in this same call), and returns the rewritten rawText, the updated
 * REQUIREMENTS.md content, and the list of newly-added entries.
 */
export function assignReqIds(rawText: string, requirementsContent: string): AssignReqIdsResult {
  const existingIds = new Set(parseRequirements(requirementsContent).map(e => e.id));
  const newEntries: RequirementEntry[] = [];

  const blocks = rawText.split(/^---$/m).map(b => b.trim()).filter(b => b.length > 0);

  const rewritten = blocks.map(block => {
    const sourceRef = extractSourceRef(block);
    const reqId = normalizeReqId(sourceRef);
    if (reqId && !existingIds.has(reqId) && !newEntries.some(e => e.id === reqId)) {
      newEntries.push({ id: reqId, text: extractRequirementText(block) });
    }
    return injectReqId(block, reqId);
  });

  return {
    rawText: rewritten.join('\n\n---\n\n'),
    updatedRequirementsContent: appendRequirements(requirementsContent, newEntries),
    newEntries,
  };
}

export interface RequirementsCoverage {
  total: number;
  covered: number;
  uncovered: RequirementEntry[];
}

/** Pure set difference: requirements with no covering @req: tag. */
export function findUncoveredRequirements(
  requirements: RequirementEntry[],
  coveredReqIds: Set<string>,
): RequirementEntry[] {
  return requirements.filter(r => !coveredReqIds.has(r.id));
}

/**
 * Cross-references REQUIREMENTS.md against @req: tags in all three test
 * registries (UI/API/E2E). Returns null when REQUIREMENTS.md doesn't exist or
 * its ledger is empty — nothing to report.
 */
export async function computeRequirementsCoverage(): Promise<RequirementsCoverage | null> {
  const content = await readFile(REQUIREMENTS_PATH, 'utf-8').catch(() => null);
  if (content === null) return null;

  const requirements = parseRequirements(content);
  if (requirements.length === 0) return null;

  const registries = await Promise.all(
    [TESTS_UI_PATH, TESTS_API_PATH, TESTS_E2E_PATH].map(p => readTestCases(p)),
  );
  const covered = new Set<string>();
  for (const entries of registries) {
    for (const entry of entries) {
      for (const reqId of extractReqIds(entry.name)) covered.add(reqId);
    }
  }

  const uncovered = findUncoveredRequirements(requirements, covered);
  return { total: requirements.length, covered: requirements.length - uncovered.length, uncovered };
}
