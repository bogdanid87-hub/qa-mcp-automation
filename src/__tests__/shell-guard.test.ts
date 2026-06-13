import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkCommand, findBlockedPattern, runGuarded, runGuardedShellDetached } from '../lib/shell-guard';

describe('findBlockedPattern', () => {
  it('matches standalone rm', () => {
    expect(findBlockedPattern('rm -rf /tmp/foo')).toBe('"rm"');
  });

  it('does not match "rm" inside another word', () => {
    expect(findBlockedPattern('should confirm order')).toBeNull();
  });

  it('matches git push', () => {
    expect(findBlockedPattern('git push origin main')).toBe('"git push"');
  });

  it('matches --force and --force-with-lease', () => {
    expect(findBlockedPattern('git push --force')).not.toBeNull();
    expect(findBlockedPattern('--force-with-lease')).not.toBeNull();
  });

  it('does not match "force" without leading --', () => {
    expect(findBlockedPattern('should force logout after timeout')).toBeNull();
  });

  it('matches --hard', () => {
    expect(findBlockedPattern('git reset --hard')).not.toBeNull();
  });

  it('matches combined -rf/-fr flags', () => {
    expect(findBlockedPattern('rm -rf .')).not.toBeNull();
    expect(findBlockedPattern('-fr build/')).not.toBeNull();
  });

  it('matches a standalone -D flag', () => {
    expect(findBlockedPattern('git branch -D feature/old')).not.toBeNull();
  });

  it('allows ordinary playwright invocations', () => {
    expect(findBlockedPattern('npx playwright test tests/ui/cart.spec.ts --grep "should add item" --project=chromium')).toBeNull();
  });
});

describe('checkCommand', () => {
  it('blocks binaries outside the allowlist', () => {
    expect(checkCommand('rm', ['-rf', '/'])).toMatch(/not in the command allowlist/);
    expect(checkCommand('git', ['push'])).toMatch(/not in the command allowlist/);
    expect(checkCommand('bash', ['-c', 'echo hi'])).toMatch(/not in the command allowlist/);
  });

  it('blocks destructive flags on otherwise-allowed binaries', () => {
    expect(checkCommand('npx', ['playwright', 'test', '--force'])).toMatch(/--force flag/);
    expect(checkCommand('npx', ['playwright', 'test', '--grep', 'git push'])).toMatch(/"git push"/);
  });

  it('allows normal playwright invocations', () => {
    expect(checkCommand('npx', ['playwright', 'test', 'tests/ui/cart.spec.ts', '--grep', 'should add item', '--project=chromium'])).toBeNull();
  });

  it('allows ollama and open', () => {
    expect(checkCommand('ollama', ['serve'])).toBeNull();
    expect(checkCommand('open', ['-a', 'Ollama'])).toBeNull();
  });
});

describe('runGuarded', () => {
  it('refuses a blocked binary without running it', async () => {
    const result = await runGuarded('rm', ['-rf', '/tmp/whatever']);
    expect(result).toMatch(/^⛔ Blocked:/);
    expect(result).toMatch(/not in the command allowlist/);
  });

  it('refuses a blocked flag on an allowed binary', async () => {
    const result = await runGuarded('npx', ['playwright', 'test', '--force']);
    expect(result).toMatch(/^⛔ Blocked:/);
    expect(result).toMatch(/--force flag/);
  });

  it('runs an allowed command and returns its output', async () => {
    const result = await runGuarded('npx', ['--version']);
    expect(result).not.toMatch(/^⛔ Blocked:/);
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

describe('runGuardedShellDetached', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a blocked command and writes a message to stderr', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    runGuardedShellDetached('rm -rf /tmp/whatever');
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^⛔ Blocked:.*rm -rf \/tmp\/whatever/));
  });

  it('does not write a blocked message for an allowed command', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    runGuardedShellDetached('true');
    expect(spy).not.toHaveBeenCalled();
  });
});
