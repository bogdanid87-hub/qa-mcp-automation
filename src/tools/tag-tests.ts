import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  readTestCases,
  registryForSpec,
  type TestEntry,
} from './test-registry.js';
import { safeWrite } from '../lib/safe-write.js';

const ROOT = process.cwd();

// Matches any existing ID comment: // [UI Contact Us Form #1], // [Visual Cart Page — Table Structure #1]
// [^\]]* matches any character except ] so em dashes and other Unicode in describe names are handled.
export const ID_COMMENT_RE = /\/\/\s*\[(UI|API|E2E|Visual)[^\]]*#\d+\]/;

/** Return the registry prefix for a spec path. */
export function prefixForSpec(specPath: string): string {
  if (specPath.startsWith('tests/api/'))    return 'API';
  if (specPath.startsWith('tests/e2e/'))    return 'E2E';
  if (specPath.startsWith('tests/visual/')) return 'Visual';
  return 'UI';
}

/**
 * Insert or update `// [PREFIX Describe #N]` comments in a spec file.
 * Placed immediately before each test() call; idempotent on repeated runs.
 */
export async function tagSpec(
  specPath: string,
  entries: TestEntry[],
  prefix: string,
): Promise<{ tagged: number; updated: number; correct: number; notFound: string[] }> {
  const abs = join(ROOT, specPath);
  let src: string;
  try {
    src = await readFile(abs, 'utf-8');
  } catch {
    return { tagged: 0, updated: 0, correct: 0, notFound: entries.map(e => e.name) };
  }

  let tagged = 0, updated = 0, correct = 0;
  const notFound: string[] = [];

  for (const entry of entries) {
    const rawName = entry.name.replace(/–/g, '|');
    const escaped = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testRe = new RegExp(`([ \\t]*)(test\\s*\\(\\s*['"\`]${escaped}['"\`])`, 'm');
    const match = testRe.exec(src);
    if (!match) { notFound.push(entry.name); continue; }

    const indent = match[1];
    const newComment = `${indent}// [${prefix} ${entry.describe} #${entry.num}]`;
    const insertAt = match.index;

    const before = src.slice(0, insertAt);
    const trimmedBefore = before.endsWith('\n') ? before.slice(0, -1) : before;
    const prevLineStart = trimmedBefore.lastIndexOf('\n') + 1;
    const prevLine = trimmedBefore.slice(prevLineStart);

    if (ID_COMMENT_RE.test(prevLine.trim())) {
      const existingMatch = prevLine.match(/\[(UI|API|E2E|Visual)[^\]]*#(\d+)\]/);
      const expectedComment = `// [${prefix} ${entry.describe} #${entry.num}]`;
      if (existingMatch && prevLine.trim() === `${indent.trim()}${expectedComment}`.trim()) {
        correct++;
      } else {
        const updatedLine = prevLine.replace(
          /\/\/\s*\[(?:UI|API|E2E|Visual)[^\]]*#\d+\]/,
          `// [${prefix} ${entry.describe} #${entry.num}]`,
        );
        src = src.slice(0, prevLineStart) + updatedLine + '\n' + src.slice(insertAt);
        updated++;
      }
    } else {
      src = src.slice(0, insertAt) + newComment + '\n' + src.slice(insertAt);
      tagged++;
    }
  }

  if (tagged > 0 || updated > 0) {
    const result = await safeWrite(abs, src);
    if (!result.ok) process.stderr.write(`[tag-tests] skipping tag update for ${specPath} — ${result.reason}\n`);
  }
  return { tagged, updated, correct, notFound };
}

/**
 * Tag a single spec file using the current registry state.
 * Called automatically after a test is recorded as passing.
 */
export async function tagSpecAfterRecording(specPath: string): Promise<void> {
  const registryPath = registryForSpec(specPath);
  const allEntries = await readTestCases(registryPath);
  const specEntries = allEntries.filter(e => e.spec === specPath);
  if (specEntries.length === 0) return;
  await tagSpec(specPath, specEntries, prefixForSpec(specPath));
}
