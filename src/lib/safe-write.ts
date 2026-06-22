import { readFile, writeFile, mkdir, rename, rm } from 'fs/promises';
import { dirname } from 'path';
import { scanForSecrets } from './scan-secrets';

export interface SafeWriteOptions {
  /** Allow shrinking the file or removing existing test()/describe() blocks. */
  allowOverwrite?: boolean;
}

export interface SafeWriteResult {
  /** True if the write succeeded, or no write was needed because content is unchanged. */
  ok: boolean;
  /** True if bytes were actually written to disk. */
  written: boolean;
  /** Unified diff between the previous content and the new content ('' if unchanged). */
  diff: string;
  /** Present when ok === false — why the write was refused. */
  reason?: string;
}

const MIN_LINES_FOR_SHRINK_CHECK = 5;
const SHRINK_RATIO = 0.5;

/** Extensions scanned for hardcoded secrets — generated specs, POMs, fixtures, mocks. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx'];

function hasScannedExtension(path: string): boolean {
  return SCANNED_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Matches `test('title'`, `describe.skip("title"`, etc. — the call signature is the unit of comparison. */
const BLOCK_RE = /\b(?:test|describe)(?:\.\w+)?\s*\(\s*(['"`])(?:\\.|(?!\1).)*\1/g;

function countNonEmptyLines(content: string): number {
  return content.split('\n').filter((l) => l.trim() !== '').length;
}

function blockSignatures(content: string): string[] {
  return [...content.matchAll(BLOCK_RE)].map((m) => m[0]);
}

/**
 * Decide whether overwriting `existing` with `next` is unsafe without explicit
 * confirmation. Returns a human-readable reason, or null if the write is safe.
 */
function describeUnsafeOverwrite(existing: string, next: string): string | null {
  const droppedBlocks = blockSignatures(existing).filter((sig) => !next.includes(sig));
  if (droppedBlocks.length > 0) {
    return `would remove ${droppedBlocks.length} existing test()/describe() block(s) — pass { allowOverwrite: true } to confirm`;
  }

  const existingLines = countNonEmptyLines(existing);
  const nextLines = countNonEmptyLines(next);
  if (existingLines >= MIN_LINES_FOR_SHRINK_CHECK && nextLines < existingLines * SHRINK_RATIO) {
    return `would shrink the file from ${existingLines} to ${nextLines} non-empty lines — pass { allowOverwrite: true } to confirm`;
  }

  return null;
}

/**
 * Write `content` to `path`, refusing to overwrite a populated file in a way that
 * shrinks it dramatically or drops existing test()/describe() blocks, unless
 * `allowOverwrite` is set. Always returns a unified diff for preview, and creates
 * parent directories as needed. A no-op (content identical to what's on disk)
 * returns `ok: true, written: false`.
 *
 * For `.ts`/`.tsx` paths, `content` is also scanned for hardcoded secrets
 * (see `scan-secrets.ts`) — a match refuses the write regardless of
 * `allowOverwrite`.
 */
export async function safeWrite(
  path: string,
  content: string,
  options: SafeWriteOptions = {},
): Promise<SafeWriteResult> {
  let existing: string | null;
  try {
    existing = await readFile(path, 'utf-8');
  } catch {
    existing = null;
  }

  if (existing === content) {
    return { ok: true, written: false, diff: '' };
  }

  const diff = unifiedDiff(existing ?? '', content, path);

  if (hasScannedExtension(path)) {
    const secrets = scanForSecrets(content);
    if (secrets.length > 0) {
      const found = secrets.map((s) => `${s.label} (${s.excerpt})`).join(', ');
      return { ok: false, written: false, diff, reason: `would write ${found} — refusing to write a secret into generated code` };
    }
  }

  if (existing !== null && !options.allowOverwrite) {
    const reason = describeUnsafeOverwrite(existing, content);
    if (reason) return { ok: false, written: false, diff, reason };
  }

  await mkdir(dirname(path), { recursive: true });
  // Atomic write: write to a temp file in the same directory, then rename over the
  // target. A crash mid-write can't leave a truncated/half-written file — readers
  // see either the old content or the complete new content, never a partial one.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => { /* best-effort cleanup */ });
    throw err;
  }
  return { ok: true, written: true, diff };
}

// ── Unified diff ─────────────────────────────────────────────────────────────

interface DiffOp {
  type: ' ' | '-' | '+';
  line: string;
}

const MAX_DIFF_CELLS = 4_000_000;
const CONTEXT_LINES = 3;

/** Line-based LCS diff. */
function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: ' ', line: oldLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: '-', line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: '+', line: newLines[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: '-', line: oldLines[i] }); i++; }
  while (j < m) { ops.push({ type: '+', line: newLines[j] }); j++; }
  return ops;
}

function buildHunks(ops: DiffOp[]): { header: string; lines: string[] }[] {
  const changeIdx: number[] = [];
  for (let k = 0; k < ops.length; k++) if (ops[k].type !== ' ') changeIdx.push(k);
  if (changeIdx.length === 0) return [];

  const groups: Array<[number, number]> = [];
  let groupStart = changeIdx[0];
  let groupEnd = changeIdx[0];
  for (let k = 1; k < changeIdx.length; k++) {
    if (changeIdx[k] - groupEnd <= CONTEXT_LINES * 2) {
      groupEnd = changeIdx[k];
    } else {
      groups.push([groupStart, groupEnd]);
      groupStart = changeIdx[k];
      groupEnd = changeIdx[k];
    }
  }
  groups.push([groupStart, groupEnd]);

  // 1-based line numbers (in old/new files) at each op index.
  const oldNum: number[] = [];
  const newNum: number[] = [];
  let oc = 1;
  let nc = 1;
  for (const op of ops) {
    oldNum.push(oc);
    newNum.push(nc);
    if (op.type !== '+') oc++;
    if (op.type !== '-') nc++;
  }

  return groups.map(([s, e]) => {
    const start = Math.max(0, s - CONTEXT_LINES);
    const end = Math.min(ops.length, e + CONTEXT_LINES + 1);
    const slice = ops.slice(start, end);
    const oldCount = slice.filter((o) => o.type !== '+').length;
    const newCount = slice.filter((o) => o.type !== '-').length;
    const oldStart = oldCount === 0 ? oldNum[start] - 1 : oldNum[start];
    const newStart = newCount === 0 ? newNum[start] - 1 : newNum[start];
    return {
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: slice.map((o) => `${o.type}${o.line}`),
    };
  });
}

/** Produce a unified diff between two file contents. Returns '' if identical. */
export function unifiedDiff(oldContent: string, newContent: string, path: string): string {
  if (oldContent === newContent) return '';

  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');

  if (oldLines.length * newLines.length > MAX_DIFF_CELLS) {
    return [
      `--- ${path}`,
      `+++ ${path}`,
      `@@ files differ (${oldLines.length} -> ${newLines.length} lines) — too large to diff inline @@`,
      '',
    ].join('\n');
  }

  const hunks = buildHunks(diffLines(oldLines, newLines));
  if (hunks.length === 0) return '';

  const lines: string[] = [
    `--- ${oldContent === '' ? '/dev/null' : path}`,
    `+++ ${newContent === '' ? '/dev/null' : path}`,
  ];
  for (const hunk of hunks) {
    lines.push(hunk.header, ...hunk.lines);
  }
  return lines.join('\n') + '\n';
}
