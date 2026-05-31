import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const ROOT = process.cwd();

export async function runTests(pattern?: string): Promise<string> {
  const patternArg = pattern ? ` ${pattern}` : '';
  const cmd = `npx playwright test${patternArg} --project=chromium 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, { cwd: ROOT, timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
    return stdout || '(no output)';
  } catch (err: any) {
    return err.stdout ?? err.message;
  }
}

export async function runTestsTool(args: {
  pattern?: string;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const text = await runTests(args.pattern);
  return { content: [{ type: 'text', text }] };
}
