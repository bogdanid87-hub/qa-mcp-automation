import { runGuarded } from '../lib/shell-guard.js';
import { config } from '../config.js';

const ROOT = process.cwd();

export type Browser = 'chromium' | 'firefox' | 'webkit' | 'visual';

/** The default Playwright project — the project's own primary project (set by learn_conventions) or "chromium". */
const DEFAULT_PROJECT = config.testing.runnerProject ?? 'chromium';

export async function runTests(pattern?: string, grep?: string, browser?: Browser | string): Promise<string> {
  const args = ['playwright', 'test'];
  if (pattern) args.push(pattern);
  if (grep) args.push('--grep', grep);
  args.push(`--project=${browser ?? DEFAULT_PROJECT}`);
  return runGuarded('npx', args, { cwd: ROOT, timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
}

export async function runTestsTool(args: {
  pattern?: string;
  grep?: string;
  browser?: Browser;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const text = await runTests(args.pattern, args.grep, args.browser);
  return { content: [{ type: 'text', text }] };
}
