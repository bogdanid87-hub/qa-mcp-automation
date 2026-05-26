import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { recordBrokenTest } from './test-registry.js';

const ROOT = process.cwd();

export type AnnotationKind = 'broken' | 'app_bug';

interface FailingTest {
  spec: string;
  describe: string;
  name: string;
}

function parseFailingTests(output: string): FailingTest[] {
  const results: FailingTest[] = [];
  const re = /\d+\)\s+\[chromium\]\s+›\s+(tests\/[^\s:]+):\d+:\d+\s+›\s+([^›\n]+?)\s+›\s+(.+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    results.push({ spec: m[1].trim(), describe: m[2].trim(), name: m[3].trim() });
  }
  // Deduplicate by spec::name
  return [...new Map(results.map(r => [`${r.spec}::${r.name}`, r])).values()];
}

function buildComment(kind: AnnotationKind, indent: string, rootCause: string, actualBehavior?: string): string {
  if (kind === 'app_bug') {
    return [
      `${indent}/* ⚠️  APP BUG — This test is correct; the application under test has a defect.`,
      `${indent} * Expected behaviour: ${rootCause}`,
      `${indent} * Actual behaviour:   ${actualBehavior ?? 'see failure output'}`,
      `${indent} * Do NOT change this test — it documents a real bug. Fix the application instead. */`,
    ].join('\n');
  }
  return [
    `${indent}/* ⚠️  BROKEN — failed and could not be auto-fixed.`,
    `${indent} * Root cause: ${rootCause}`,
    `${indent} * Fix manually or run: npm run fix */`,
  ].join('\n');
}

/**
 * Write an annotation comment directly before each failing test() call in the spec,
 * and record the failure in TEST_CASES.md under the appropriate section.
 */
export async function writeTestAnnotation(
  specPath: string,
  failureOutput: string,
  kind: AnnotationKind,
  rootCause: string,
  actualBehavior?: string,
): Promise<void> {
  const abs = join(ROOT, specPath);
  let src: string;
  try { src = await readFile(abs, 'utf-8'); } catch { return; }

  const failingTests = parseFailingTests(failureOutput);
  const failingNames = failingTests.map(t => t.name);

  // Write annotation comments into the spec file
  if (failingNames.length === 0) {
    await writeFile(abs, buildComment(kind, '', rootCause, actualBehavior) + '\n\n' + src, 'utf-8');
  } else {
    let updated = src;
    for (const name of failingNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`([ \\t]*)(test\\s*\\(\\s*['"\`]${escaped}['"\`])`, 'm');
      updated = updated.replace(re, (_, indent, testCall) =>
        `${buildComment(kind, indent, rootCause, actualBehavior)}\n${indent}${testCall}`
      );
    }
    await writeFile(abs, updated, 'utf-8');
  }

  // Record each failing test in TEST_CASES.md
  for (const t of failingTests) {
    await recordBrokenTest({ ...t, kind, rootCause, actualBehavior });
  }

  // Fallback: if the output didn't contain parseable test names, record using specPath alone
  if (failingTests.length === 0) {
    await recordBrokenTest({ spec: specPath, describe: '', name: specPath, kind, rootCause, actualBehavior });
  }
}
