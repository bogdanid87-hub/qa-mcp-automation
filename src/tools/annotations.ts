import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { recordBrokenTest, registryForSpec, parseFailingTestsFromOutput } from './test-registry.js';

const ROOT = process.cwd();

export type AnnotationKind = 'broken' | 'app_bug';

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
 * Read the annotation comment immediately preceding a named test() call.
 * Returns kind, rootCause, and (for app_bug) actualBehavior if an annotation is present.
 * Returns null if no annotation is found or the spec cannot be read.
 */
export async function readAnnotationFromSpec(
  specPath: string,
  testName: string,
): Promise<{ kind: AnnotationKind; rootCause: string; actualBehavior?: string } | null> {
  const abs = join(ROOT, specPath);
  let src: string;
  try { src = await readFile(abs, 'utf-8'); } catch { return null; }

  const escaped = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const testMatch = new RegExp(`test\\s*\\(\\s*['"\`]${escaped}['"\`]`).exec(src);
  if (!testMatch) return null;

  // Find the last block comment before this test call
  const before = src.slice(0, testMatch.index);
  const commentRe = /\/\*([\s\S]*?)\*\//g;
  let lastComment: { body: string; end: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = commentRe.exec(before)) !== null) {
    lastComment = { body: m[1], end: m.index + m[0].length };
  }
  if (!lastComment) return null;

  // Only trust the comment if only whitespace separates it from the test call
  if (src.slice(lastComment.end, testMatch.index).trim() !== '') return null;

  const body = lastComment.body;

  if (body.includes('APP BUG')) {
    return {
      kind: 'app_bug',
      rootCause: body.match(/\*\s*Expected behaviour:\s*(.+)/)?.[1]?.trim() ?? 'see spec file',
      actualBehavior: body.match(/\*\s*Actual behaviour:\s*(.+)/)?.[1]?.trim(),
    };
  }

  if (body.includes('BROKEN')) {
    return {
      kind: 'broken',
      rootCause: body.match(/\*\s*Root cause:\s*(.+)/)?.[1]?.trim() ?? 'see spec file',
    };
  }

  return null;
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

  const failingTests = parseFailingTestsFromOutput(failureOutput);
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

  // Record each failing test in the appropriate registry
  const registry = registryForSpec(specPath);
  for (const t of failingTests) {
    await recordBrokenTest({ ...t, kind, rootCause, actualBehavior }, registry);
  }

  // Fallback: if the output didn't contain parseable test names, record using specPath alone
  if (failingTests.length === 0) {
    await recordBrokenTest({ spec: specPath, describe: '', name: specPath, kind, rootCause, actualBehavior }, registry);
  }
}
