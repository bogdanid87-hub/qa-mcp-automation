import { readFile } from 'fs/promises';
import { safeWrite } from '../lib/safe-write.js';
import {
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
  registryForSpec,
  deriveRisk,
} from '../config.js';

export { TESTS_UI_PATH, TESTS_API_PATH, TESTS_E2E_PATH, TESTS_VISUAL_PATH, registryForSpec, deriveRisk };

/** Replace characters that would break markdown table cells. */
function sanitizeCell(s: string): string {
  return s.replace(/\|/g, '–').replace(/\n/g, ' ').trim();
}

// ─── Passing tests ────────────────────────────────────────────────────────────

export interface TestEntry {
  num: number;
  spec: string;
  describe: string;
  name: string;
}

export interface PassingTest {
  title: string; // e.g. "Contact Us Form › should submit the form..."
  spec: string;  // e.g. "tests/contactUs.spec.ts"
}

export function parsePassingTests(output: string): PassingTest[] {
  const results: PassingTest[] = [];
  const re = /✓\s+\d+\s+\[chromium\]\s+›\s+(tests\/[^:]+):\d+:\d+\s+›\s+(.+?)\s+\(\d+/g;
  let match;
  while ((match = re.exec(output)) !== null) {
    results.push({ spec: match[1].trim(), title: match[2].trim() });
  }
  return results;
}

export function parseTestCases(content: string): TestEntry[] {
  const entries: TestEntry[] = [];
  let currentSpec = '';
  let currentDescribe = '';

  for (const line of content.split('\n')) {
    const specMatch = line.match(/^## (tests\/.+\.spec\.ts)/);
    if (specMatch) { currentSpec = specMatch[1]; continue; }

    const describeMatch = line.match(/^### (.+)/);
    if (describeMatch) { currentDescribe = describeMatch[1]; continue; }

    const rowMatch = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|$/);
    if (rowMatch && currentSpec && currentDescribe) {
      const name = rowMatch[2].replace(/\s*←\s*latest\s*$/, '').trim(); // handle legacy files
      entries.push({ num: parseInt(rowMatch[1], 10), spec: currentSpec, describe: currentDescribe, name });
    }
  }

  return entries; // file order is already spec-grouped; sort by num would scramble per-section numbering
}

// ─── Broken / app-bug tests ───────────────────────────────────────────────────

export interface BrokenEntry {
  spec: string;
  describe: string;
  name: string;
  kind: 'broken' | 'app_bug';
  rootCause: string;
  actualBehavior?: string;
  risk?: 'critical' | 'high' | 'medium' | 'low';
}

const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function extractSection(content: string, header: string): string {
  const start = content.indexOf(header);
  if (start === -1) return '';
  const rest = content.slice(start + header.length);
  const nextSection = rest.search(/\n## /);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

function parseTableRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length === 0) continue;
    if (cells.every(c => /^[-: ]+$/.test(c))) continue; // separator row
    if (cells[0] === 'Spec' || cells[0] === 'Risk' || cells[0] === 'Priority') continue; // header row
    rows.push(cells);
  }
  return rows;
}

export function parseBrokenTests(content: string): BrokenEntry[] {
  const entries: BrokenEntry[] = [];

  for (const row of parseTableRows(extractSection(content, '## ⚠️ Application Bugs'))) {
    // Support both old format (Spec|Describe|Test|Root cause|Actual behaviour)
    // and new format (Risk|Spec|Describe|Test|Root cause|Actual behaviour)
    const hasRisk = row.length >= 6;
    const [a, b, c, d, e, f] = row;
    const risk = hasRisk ? (a as BrokenEntry['risk']) : undefined;
    const [spec, describe, name, rootCause, actualBehavior] = hasRisk ? [b, c, d, e, f] : [a, b, c, d, e];
    if (spec && describe && name && rootCause) {
      entries.push({ spec, describe, name, kind: 'app_bug', rootCause, actualBehavior: actualBehavior || undefined, risk });
    }
  }

  for (const row of parseTableRows(extractSection(content, '## ❌ Broken Tests'))) {
    // Support both old format (Spec|Describe|Test|Root cause)
    // and new format (Risk|Spec|Describe|Test|Root cause)
    const hasRisk = row.length >= 5;
    const [a, b, c, d, e] = row;
    const risk = hasRisk ? (a as BrokenEntry['risk']) : undefined;
    const [spec, describe, name, rootCause] = hasRisk ? [b, c, d, e] : [a, b, c, d];
    if (spec && describe && name && rootCause) {
      entries.push({ spec, describe, name, kind: 'broken', rootCause, risk });
    }
  }

  return entries;
}

// ─── File builder ─────────────────────────────────────────────────────────────

export function buildContent(entries: TestEntry[], broken: BrokenEntry[] = []): string {
  const lines: string[] = ['# Test Cases', ''];

  if (entries.length === 0) {
    lines.push('**Total: 0 passing tests**', '');
  } else {
    lines.push(`**Total: ${entries.length} ${entries.length === 1 ? 'test' : 'tests'}**`, '');

    const groups = new Map<string, Map<string, TestEntry[]>>();
    for (const entry of entries) {
      if (!groups.has(entry.spec)) groups.set(entry.spec, new Map());
      const byDescribe = groups.get(entry.spec)!;
      if (!byDescribe.has(entry.describe)) byDescribe.set(entry.describe, []);
      byDescribe.get(entry.describe)!.push(entry);
    }

    for (const [spec, byDescribe] of groups) {
      lines.push('---', '', `## ${spec}`, '');
      for (const [describe, tests] of byDescribe) {
        lines.push(`### ${describe}`, '');
        lines.push('| # | Test |');
        lines.push('|---|------|');
        let n = 1;
        for (const t of tests) {
          lines.push(`| ${n++} | ${sanitizeCell(t.name)} |`);
        }
        lines.push('');
      }
    }
  }

  const sortByRisk = (a: BrokenEntry, b: BrokenEntry) =>
    (RISK_ORDER[a.risk ?? 'low'] ?? 3) - (RISK_ORDER[b.risk ?? 'low'] ?? 3);

  const appBugs = broken.filter(e => e.kind === 'app_bug').sort(sortByRisk);
  if (appBugs.length > 0) {
    lines.push('---', '', '## ⚠️ Application Bugs', '');
    lines.push('> These tests are correct — the application has a defect. Do not modify them.', '');
    lines.push('| Risk | Spec | Describe | Test | Root cause | Actual behaviour |');
    lines.push('|------|------|----------|------|------------|-----------------|');
    for (const e of appBugs) {
      const risk = e.risk ?? deriveRisk(e.spec, e.describe);
      lines.push(`| ${risk} | ${e.spec} | ${e.describe} | ${sanitizeCell(e.name)} | ${sanitizeCell(e.rootCause)} | ${sanitizeCell(e.actualBehavior ?? '—')} |`);
    }
    lines.push('');
  }

  const brokenTests = broken.filter(e => e.kind === 'broken').sort(sortByRisk);
  if (brokenTests.length > 0) {
    lines.push('---', '', '## ❌ Broken Tests', '');
    lines.push('> Fix manually or run: `npm run fix -- --pattern <spec>`', '');
    lines.push('| Risk | Spec | Describe | Test | Root cause |');
    lines.push('|------|------|----------|------|------------|');
    for (const e of brokenTests) {
      const risk = e.risk ?? deriveRisk(e.spec, e.describe);
      lines.push(`| ${risk} | ${e.spec} | ${e.describe} | ${sanitizeCell(e.name)} | ${sanitizeCell(e.rootCause)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Name normalisation ───────────────────────────────────────────────────────

/**
 * Normalise a test name for fuzzy comparison.
 * Strips English articles, lowercases, collapses punctuation and whitespace so
 * that "should place an order" and "should place order" compare as equal.
 */
export function normalizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(a|an|the)\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Output parsers ───────────────────────────────────────────────────────────

export interface FailingTestResult {
  spec: string;
  describe: string;
  name: string;
}

/**
 * Parse every failing test from a Playwright run's stdout.
 * Tries inline ✗ markers first; also parses the numbered failure list so both
 * sources are covered and deduplicated.
 */
export function parseFailingTestsFromOutput(output: string): FailingTestResult[] {
  const results: FailingTestResult[] = [];

  // Inline ✗ markers — same layout as ✓ but without guaranteed timing suffix
  const inlineRe = /✗\s+\d+\s+\[chromium\]\s+›\s+(tests\/[^:]+):\d+:\d+\s+›\s+(.+?)(?:\s+\(\d+m?s\))?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(output)) !== null) {
    const spec = m[1].trim();
    const title = m[2].trim();
    const sep = title.indexOf(' › ');
    if (sep === -1) continue;
    results.push({ spec, describe: title.substring(0, sep), name: title.substring(sep + 3) });
  }

  // Numbered failure block at the bottom of the output
  const numberedRe = /\d+\)\s+\[chromium\]\s+›\s+(tests\/[^\s:]+):\d+:\d+\s+›\s+([^›\n]+?)\s+›\s+(.+)/gm;
  while ((m = numberedRe.exec(output)) !== null) {
    results.push({ spec: m[1].trim(), describe: m[2].trim(), name: m[3].trim() });
  }

  return [...new Map(results.map(r => [`${r.spec}::${r.name}`, r])).values()];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function recordPassingTests(
  passing: PassingTest[],
): Promise<void> {
  if (passing.length === 0) return;

  // Group by the registry each test actually belongs in, so a broad run (no --pattern)
  // never contaminates TESTS_UI.md with API or E2E entries.
  const byRegistry = new Map<string, PassingTest[]>();
  for (const t of passing) {
    const reg = registryForSpec(t.spec);
    if (!byRegistry.has(reg)) byRegistry.set(reg, []);
    byRegistry.get(reg)!.push(t);
  }

  for (const [reg, tests] of byRegistry) {
    let content = '';
    try { content = await readFile(reg, 'utf-8'); } catch { /* new file */ }

    const existing = parseTestCases(content);
    const broken = parseBrokenTests(content);
    const existingKeys = new Set(existing.map((e) => `${e.spec}::${e.name}`));
    let nextNum = existing.length + 1;
    let changed = false;

    for (const t of tests) {
      const sep = t.title.indexOf(' › ');
      if (sep === -1) continue;
      const describe = t.title.substring(0, sep);
      const name = t.title.substring(sep + 3);
      const key = `${t.spec}::${name}`;
      if (!existingKeys.has(key)) {
        existing.push({ num: nextNum++, spec: t.spec, describe, name });
        existingKeys.add(key);
        changed = true;
      }
    }

    if (changed) await safeWrite(reg, buildContent(existing, broken), { allowOverwrite: true });
  }
}

/** Add a broken or app-bug test to the appropriate registry. Skips if already recorded. */
export async function recordBrokenTest(
  entry: BrokenEntry,
  registryPath = TESTS_UI_PATH,
): Promise<void> {
  let content = '';
  try { content = await readFile(registryPath, 'utf-8'); } catch { /* new file */ }

  const passing = parseTestCases(content);
  const broken = parseBrokenTests(content);

  const key = `${entry.spec}::${entry.name}`;
  if (broken.some(e => `${e.spec}::${e.name}` === key)) return;

  // Auto-derive risk if not supplied by the caller
  const enriched: BrokenEntry = entry.risk ? entry : { ...entry, risk: deriveRisk(entry.spec, entry.describe) };
  broken.push(enriched);
  await safeWrite(registryPath, buildContent(passing, broken), { allowOverwrite: true });
}

/** Remove entries whose tests now pass. */
export async function removeResolvedBrokenTests(
  resolvedKeys: Set<string>,
  registryPath = TESTS_UI_PATH,
): Promise<void> {
  let content = '';
  try { content = await readFile(registryPath, 'utf-8'); } catch { return; }

  const passing = parseTestCases(content);
  const broken = parseBrokenTests(content);
  const updated = broken.filter(e => !resolvedKeys.has(`${e.spec}::${e.name}`));

  if (updated.length !== broken.length) {
    await safeWrite(registryPath, buildContent(passing, updated), { allowOverwrite: true });
  }
}

/**
 * Move passing tests that have become regressions into the ❌ Broken section.
 */
export async function demoteTobroken(
  entries: BrokenEntry[],
  registryPath = TESTS_UI_PATH,
): Promise<void> {
  if (entries.length === 0) return;

  let content = '';
  try { content = await readFile(registryPath, 'utf-8'); } catch { return; }

  const passing = parseTestCases(content);
  const broken = parseBrokenTests(content);

  const demoteKeys = new Set(entries.map(e => `${e.spec}::${e.name}`));
  const brokenKeys = new Set(broken.map(e => `${e.spec}::${e.name}`));

  const updatedPassing = passing.filter(e => !demoteKeys.has(`${e.spec}::${e.name}`));

  for (const entry of entries) {
    const key = `${entry.spec}::${entry.name}`;
    if (brokenKeys.has(key)) continue;
    const passingEntry = passing.find(e => `${e.spec}::${e.name}` === key);
    const describe = entry.describe || passingEntry?.describe || '';
    broken.push({
      spec: entry.spec,
      describe,
      name: entry.name,
      kind: entry.kind,
      rootCause: entry.rootCause,
      actualBehavior: entry.actualBehavior,
      risk: entry.risk ?? deriveRisk(entry.spec, describe),
    });
    brokenKeys.add(key);
  }

  await safeWrite(registryPath, buildContent(updatedPassing, broken), { allowOverwrite: true });
}

/** Read all broken/app-bug entries from the given registry (defaults to TEST_CASES.md). */
export async function readBrokenTests(registryPath = TESTS_UI_PATH): Promise<BrokenEntry[]> {
  try {
    return parseBrokenTests(await readFile(registryPath, 'utf-8'));
  } catch {
    return [];
  }
}

/** Read all recorded passing test cases from the given registry (defaults to TEST_CASES.md). */
export async function readTestCases(registryPath = TESTS_UI_PATH): Promise<TestEntry[]> {
  try {
    return parseTestCases(await readFile(registryPath, 'utf-8'));
  } catch {
    return [];
  }
}

