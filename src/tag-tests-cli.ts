import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  readTestCases,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  type TestEntry,
} from './tools/test-registry.js';

const ROOT = process.cwd();

const REGISTRIES: Array<{ path: string; prefix: string }> = [
  { path: TESTS_UI_PATH, prefix: 'UI'  },
  { path: TESTS_API_PATH,   prefix: 'API' },
  { path: TESTS_E2E_PATH,   prefix: 'E2E' },
];

// Matches any existing ID comment: // [UI Contact Us Form #1], // [API Products API #3]
// Also matches old format // [UI #1] for backward compatibility
const ID_COMMENT_RE = /\/\/\s*\[(UI|API|E2E)[\s\w:#-]*#\d+\]/;

/**
 * Insert or update `// [PREFIX #N]` comments in a spec file.
 * The comment is placed immediately before each test() call.
 * Existing ID comments are updated if the number changed; skipped if already correct.
 * BROKEN / APP BUG block comment annotations are preserved — the ID comment sits
 * between any annotation block and the test() call.
 */
async function tagSpec(
  specPath: string,
  entries: TestEntry[],
  prefix: string,
): Promise<{ tagged: number; updated: number; correct: number; notFound: string[] }> {
  const abs = join(ROOT, specPath);
  let src: string;
  try {
    src = await readFile(abs, 'utf-8');
  } catch {
    // Spec file missing — registry is stale, caller will warn the user
    return { tagged: 0, updated: 0, correct: 0, notFound: entries.map(e => e.name) };
  }

  let tagged = 0, updated = 0, correct = 0;
  const notFound: string[] = [];

  for (const entry of entries) {
    // Reverse sanitizeCell()'s | → – substitution before building the regex,
    // so test names containing pipe characters are matched correctly.
    const rawName = entry.name.replace(/–/g, '|');
    const escaped = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testRe = new RegExp(`([ \\t]*)(test\\s*\\(\\s*['"\`]${escaped}['"\`])`, 'm');
    const match = testRe.exec(src);
    if (!match) {
      notFound.push(entry.name);
      continue;
    }

    const indent = match[1];
    const newComment = `${indent}// [${prefix} ${entry.describe} #${entry.num}]`;
    const insertAt = match.index;

    // Find the line immediately before the test() call.
    // before ends with '\n  ' (the newline + indent before test()), so strip the
    // trailing newline first — otherwise lastIndexOf finds that '\n' and prevLine is empty.
    const before = src.slice(0, insertAt);
    const trimmedBefore = before.endsWith('\n') ? before.slice(0, -1) : before;
    const prevLineStart = trimmedBefore.lastIndexOf('\n') + 1;
    const prevLine = trimmedBefore.slice(prevLineStart);

    if (ID_COMMENT_RE.test(prevLine.trim())) {
      // There is already an ID comment — check if it needs updating
      const existingMatch = prevLine.match(/\[(UI|API|E2E)[\s\w:#-]*#(\d+)\]/);
      const expectedComment = `// [${prefix} ${entry.describe} #${entry.num}]`;
      if (existingMatch && prevLine.trim() === `${indent.trim()}${expectedComment}`.trim()) {
        correct++;
      } else {
        // Update to the correct format (prefix + describe + number)
        const updatedLine = prevLine.replace(
          /\/\/\s*\[(?:UI|API|E2E)[\s\w:#-]*#\d+\]/,
          `// [${prefix} ${entry.describe} #${entry.num}]`,
        );
        src = src.slice(0, prevLineStart) + updatedLine + src.slice(insertAt);
        updated++;
      }
    } else {
      // No ID comment yet — insert one immediately before the test() call
      src = src.slice(0, insertAt) + newComment + '\n' + src.slice(insertAt);
      tagged++;
    }
  }

  if (tagged > 0 || updated > 0) {
    await writeFile(abs, src, 'utf-8');
  }
  return { tagged, updated, correct, notFound };
}

async function main(): Promise<void> {
  console.log('\n🏷️  Tagging tests with registry IDs...\n');

  let totalTagged = 0, totalUpdated = 0, totalCorrect = 0;
  const warnings: string[] = [];

  for (const { path, prefix } of REGISTRIES) {
    const entries = await readTestCases(path);
    if (entries.length === 0) continue;

    // Group by spec file
    const bySpec = new Map<string, TestEntry[]>();
    for (const entry of entries) {
      if (!bySpec.has(entry.spec)) bySpec.set(entry.spec, []);
      bySpec.get(entry.spec)!.push(entry);
    }

    for (const [spec, specEntries] of bySpec) {
      const { tagged, updated, correct, notFound } = await tagSpec(spec, specEntries, prefix);

      // Missing spec file: all entries returned as notFound with no src read
      if (notFound.length === specEntries.length && tagged === 0 && updated === 0 && correct === 0) {
        warnings.push(`  ⚠️  [${prefix}] ${spec} — file not found on disk (run sync_registry to clean up)`);
        continue;
      }

      totalTagged  += tagged;
      totalUpdated += updated;
      totalCorrect += correct;

      if (tagged > 0 || updated > 0) {
        const parts = [
          tagged  > 0 ? `+${tagged} added`   : '',
          updated > 0 ? `~${updated} updated` : '',
        ].filter(Boolean).join(', ');
        console.log(`  [${prefix}] ${spec} — ${parts}`);
      }

      for (const name of notFound) {
        warnings.push(`  ⚠️  [${prefix}] ${spec} — test name not found in file: "${name}" (test may have been renamed — run sync_registry)`);
      }
    }
  }

  if (warnings.length > 0) {
    console.log('\n' + warnings.join('\n'));
  }

  if (totalTagged === 0 && totalUpdated === 0) {
    console.log('\n  All tests already tagged — nothing to do.\n');
    return;
  }

  const eq = '═'.repeat(48);
  console.log(`\n${eq}`);
  console.log(`  Done: ${totalTagged} added, ${totalUpdated} updated, ${totalCorrect} already correct`);
  if (warnings.length > 0) console.log(`  ${warnings.length} warning${warnings.length === 1 ? '' : 's'} — see above`);
  console.log(`${eq}\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
