import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const ROOT = process.cwd();

export type Browser = 'chromium' | 'firefox' | 'webkit' | 'visual';

export async function runTests(pattern?: string, grep?: string, browser: Browser = 'chromium'): Promise<string> {
  const patternArg = pattern ? ` ${pattern}` : '';
  const grepArg    = grep    ? ` --grep ${JSON.stringify(grep)}` : '';
  const projectArg = ` --project=${browser}`;
  const cmd = `npx playwright test${patternArg}${grepArg}${projectArg} 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, { cwd: ROOT, timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
    return stdout || '(no output)';
  } catch (err: any) {
    return err.stdout ?? err.message;
  }
}

export async function runTestsTool(args: {
  pattern?: string;
  grep?: string;
  browser?: Browser;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const text = await runTests(args.pattern, args.grep, args.browser ?? 'chromium');
  return { content: [{ type: 'text', text }] };
}
