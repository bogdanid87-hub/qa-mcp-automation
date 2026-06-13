import { exec as execCb, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

export interface GuardedExecOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
}

/** Binaries the server is permitted to invoke via runGuarded(). */
export const ALLOWED_BINARIES = new Set(['npx', 'ollama', 'open']);

/**
 * Patterns that are refused wherever they appear — in the command, an
 * argument, or a hardcoded shell string — regardless of which binary they're
 * attached to. These can destroy local work (rm -rf), rewrite shared git
 * history (git push, --force), or force-delete branches (-D, --hard).
 */
const BLOCKED_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\b/i, label: '"rm"' },
  { re: /\bgit\s+push\b/i, label: '"git push"' },
  { re: /--force(-with-lease)?\b/i, label: 'a --force flag' },
  { re: /--hard\b/i, label: 'a --hard flag' },
  { re: /(^|\s)-{1,2}D(\s|$)/, label: 'a -D (force-delete) flag' },
];

const RF_FLAG_LABEL = 'a combined -rf/-fr flag';

/** True for single-dash combined short flags containing both r and f, e.g. -rf, -fr, -vrf. */
function hasCombinedRfFlag(text: string): boolean {
  return text.split(/\s+/).some((token) => {
    if (!/^-[a-z]+$/i.test(token)) return false;
    const flags = token.slice(1).toLowerCase();
    return flags.includes('r') && flags.includes('f');
  });
}

/** Returns the label of the first blocked pattern found in `text`, or null. */
export function findBlockedPattern(text: string): string | null {
  for (const { re, label } of BLOCKED_PATTERNS) {
    if (re.test(text)) return label;
  }
  if (hasCombinedRfFlag(text)) return RF_FLAG_LABEL;
  return null;
}

/**
 * Checks whether `command`/`args` are safe to execute: `command` must be an
 * allowlisted binary, and neither the command nor its arguments may match a
 * blocked destructive pattern. Returns a refusal reason, or null if safe.
 */
export function checkCommand(command: string, args: string[]): string | null {
  if (!ALLOWED_BINARIES.has(command)) {
    return `"${command}" is not in the command allowlist (${[...ALLOWED_BINARIES].join(', ')})`;
  }
  const blocked = findBlockedPattern([command, ...args].join(' '));
  if (blocked) return `command contains ${blocked}, which is not permitted`;
  return null;
}

/**
 * Run `command` with `args` via execFile (no shell — arguments can't escape
 * into separate commands), after checking the binary is allowlisted and
 * neither the command nor its arguments match a blocked destructive pattern.
 * Blocked commands are not run; a refusal string is returned (rather than
 * thrown) since callers surface this text directly as tool output.
 */
export async function runGuarded(
  command: string,
  args: string[],
  options: GuardedExecOptions = {},
): Promise<string> {
  const reason = checkCommand(command, args);
  if (reason) return `⛔ Blocked: ${reason}.`;

  try {
    const { stdout, stderr } = await execFileAsync(command, args, options);
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    return combined || '(no output)';
  } catch (err: any) {
    const combined = [err.stdout, err.stderr].filter(Boolean).join('\n');
    return combined || err.message;
  }
}

/**
 * Fire-and-forget a hardcoded shell command, after checking it doesn't match
 * a blocked destructive pattern. For commands that need shell features (||,
 * &>, background &) and take no external input — e.g. starting a local
 * dependency. Mirrors the no-callback `exec()` call it replaces: errors are
 * not surfaced to the caller.
 */
export function runGuardedShellDetached(cmd: string): void {
  const blocked = findBlockedPattern(cmd);
  if (blocked) {
    process.stderr.write(`⛔ Blocked: command contains ${blocked}, which is not permitted: ${cmd}\n`);
    return;
  }
  execCb(cmd);
}
