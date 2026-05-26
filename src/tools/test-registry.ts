import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd();
const TEST_CASES_PATH = join(ROOT, 'TEST_CASES.md');

const STOPWORDS = new Set([
  'test', 'that', 'with', 'from', 'this', 'should', 'will', 'when', 'then',
  'have', 'been', 'make', 'into', 'also', 'which', 'verify', 'check', 'click',
  'step', 'navigate', 'browser', 'launch', 'enter', 'submit', 'form', 'button',
  'page', 'visible', 'successfully', 'invalid', 'valid', 'using',
]);

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
}

/** Shared prefix (first 6 chars) used as a lightweight stem. */
function stem(w: string): string {
  return w.slice(0, Math.min(6, w.length));
}

function stemOverlap(aWords: string[], bWords: string[]): number {
  const bStems = bWords.map(stem);
  return aWords.filter(w => bStems.includes(stem(w))).length;
}

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

function parseTestCases(content: string): TestEntry[] {
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
      const name = rowMatch[2].replace(/\s*←\s*latest\s*$/, '').trim();
      entries.push({ num: parseInt(rowMatch[1], 10), spec: currentSpec, describe: currentDescribe, name });
    }
  }

  return entries.sort((a, b) => a.num - b.num);
}

function buildContent(entries: TestEntry[]): string {
  if (entries.length === 0) return '# Test Cases\n\n**Total: 0 tests**\n';

  const latest = entries[entries.length - 1];
  const total = entries.length;
  const latestLabel = `#${latest.num} — ${latest.describe} › ${latest.name}`;

  const groups = new Map<string, Map<string, TestEntry[]>>();
  for (const entry of entries) {
    if (!groups.has(entry.spec)) groups.set(entry.spec, new Map());
    const byDescribe = groups.get(entry.spec)!;
    if (!byDescribe.has(entry.describe)) byDescribe.set(entry.describe, []);
    byDescribe.get(entry.describe)!.push(entry);
  }

  const lines: string[] = [
    '# Test Cases',
    '',
    `**Total: ${total} ${total === 1 ? 'test' : 'tests'}** | **Latest:** ${latestLabel}`,
    '',
  ];

  for (const [spec, byDescribe] of groups) {
    lines.push('---', '', `## ${spec}`, '');
    for (const [describe, tests] of byDescribe) {
      lines.push(`### ${describe}`, '');
      lines.push('| # | Test |');
      lines.push('|---|------|');
      for (const t of tests) {
        const marker = t.num === latest.num ? ' ← latest' : '';
        lines.push(`| ${t.num} | ${t.name}${marker} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function recordPassingTests(passing: PassingTest[]): Promise<void> {
  if (passing.length === 0) return;

  let content = '';
  try { content = await readFile(TEST_CASES_PATH, 'utf-8'); } catch { /* new file */ }

  const existing = parseTestCases(content);
  const existingKeys = new Set(existing.map((e) => `${e.spec}::${e.name}`));
  let nextNum = existing.length > 0 ? Math.max(...existing.map((e) => e.num)) + 1 : 1;
  let changed = false;

  for (const t of passing) {
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

  if (changed) await writeFile(TEST_CASES_PATH, buildContent(existing), 'utf-8');
}

/** Read all recorded test cases from TEST_CASES.md (returns [] if file missing). */
export async function readTestCases(): Promise<TestEntry[]> {
  try {
    return parseTestCases(await readFile(TEST_CASES_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Return entries from `all` that appear similar to `description`.
 * Similarity: the describe-block name must stem-overlap with the description,
 * AND at least one word from the test name must also stem-overlap.
 */
export function findSimilarTests(description: string, all: TestEntry[]): TestEntry[] {
  const descWords = extractWords(description);
  if (descWords.length === 0) return [];

  return all.filter(entry => {
    const featureWords = extractWords(entry.describe);
    if (stemOverlap(featureWords, descWords) === 0) return false;
    const nameWords = extractWords(entry.name);
    return stemOverlap(nameWords, descWords) >= 1;
  });
}
