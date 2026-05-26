import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd();

export type AnnotationKind = 'broken' | 'app_bug';

function parseFailingTestNames(output: string): string[] {
  const names: string[] = [];
  const re = /\d+\)\s+\[chromium\]\s+›\s+[^›\n]+›\s+[^›\n]+›\s+(.+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) names.push(m[1].trim());
  return [...new Set(names)];
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
 * Write an annotation comment directly before each failing test() call in the spec.
 * Falls back to prepending at the top of the file if test names cannot be parsed.
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

  const failingNames = parseFailingTestNames(failureOutput);
  if (failingNames.length === 0) {
    await writeFile(abs, buildComment(kind, '', rootCause, actualBehavior) + '\n\n' + src, 'utf-8');
    return;
  }

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
