import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { safeWrite, unifiedDiff } from '../lib/safe-write';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'safe-write-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SPEC = `import { test, expect } from '../../fixtures';

test.describe('Cart', () => {
  test('should add a product', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.product')).toBeVisible();
  });

  test('should remove a product', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.locator('.empty')).toBeVisible();
  });
});
`;

// ── safeWrite ────────────────────────────────────────────────────────────────

describe('safeWrite', () => {
  it('creates a new file and reports it as written', async () => {
    const path = join(dir, 'new.ts');
    const result = await safeWrite(path, 'hello\n');
    expect(result.ok).toBe(true);
    expect(result.written).toBe(true);
    expect(await readFile(path, 'utf-8')).toBe('hello\n');
  });

  it('creates parent directories as needed', async () => {
    const path = join(dir, 'nested', 'dir', 'file.ts');
    const result = await safeWrite(path, 'content\n');
    expect(result.ok).toBe(true);
    expect(await readFile(path, 'utf-8')).toBe('content\n');
  });

  it('is a no-op when content is unchanged', async () => {
    const path = join(dir, 'file.ts');
    await safeWrite(path, 'same\n');
    const result = await safeWrite(path, 'same\n');
    expect(result.ok).toBe(true);
    expect(result.written).toBe(false);
    expect(result.diff).toBe('');
  });

  it('allows appending to an existing spec without allowOverwrite', async () => {
    const path = join(dir, 'cart.spec.ts');
    await safeWrite(path, SPEC);

    const appended = SPEC.replace(
      '});\n',
      `\n  test('should update quantity', async ({ page }) => {\n    await page.goto('/cart');\n  });\n});\n`,
    );
    const result = await safeWrite(path, appended);
    expect(result.ok).toBe(true);
    expect(result.written).toBe(true);
    expect(await readFile(path, 'utf-8')).toBe(appended);
  });

  it('refuses to overwrite a populated spec that drops a test() block', async () => {
    const path = join(dir, 'cart.spec.ts');
    await safeWrite(path, SPEC);

    const stripped = `import { test, expect } from '../../fixtures';

test.describe('Cart', () => {
  test('should add a product', async ({ page }) => {
    await page.goto('/');
  });
});
`;
    const result = await safeWrite(path, stripped);
    expect(result.ok).toBe(false);
    expect(result.written).toBe(false);
    expect(result.reason).toContain('test()/describe() block');
    expect(result.diff).not.toBe('');
    // File on disk must be untouched
    expect(await readFile(path, 'utf-8')).toBe(SPEC);
  });

  it('allows dropping a test() block when allowOverwrite is true', async () => {
    const path = join(dir, 'cart.spec.ts');
    await safeWrite(path, SPEC);

    const stripped = `import { test, expect } from '../../fixtures';

test.describe('Cart', () => {
  test('should add a product', async ({ page }) => {
    await page.goto('/');
  });
});
`;
    const result = await safeWrite(path, stripped, { allowOverwrite: true });
    expect(result.ok).toBe(true);
    expect(result.written).toBe(true);
    expect(await readFile(path, 'utf-8')).toBe(stripped);
  });

  it('refuses to drastically shrink a populated file with no test/describe blocks', async () => {
    const path = join(dir, 'report.md');
    const big = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
    await safeWrite(path, big);

    const small = 'line 0\nline 1\n';
    const result = await safeWrite(path, small);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('shrink');
    expect(await readFile(path, 'utf-8')).toBe(big);
  });

  it('allows drastic shrink when allowOverwrite is true', async () => {
    const path = join(dir, 'report.md');
    const big = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
    await safeWrite(path, big);

    const small = 'line 0\nline 1\n';
    const result = await safeWrite(path, small, { allowOverwrite: true });
    expect(result.ok).toBe(true);
    expect(await readFile(path, 'utf-8')).toBe(small);
  });

  it('allows a small reduction in line count that keeps all blocks', async () => {
    const path = join(dir, 'cart.spec.ts');
    await safeWrite(path, SPEC);

    // Drop a blank line but keep both test() blocks intact.
    const tightened = SPEC.replace('  });\n\n  test(\'should remove', '  });\n  test(\'should remove');
    const result = await safeWrite(path, tightened);
    expect(result.ok).toBe(true);
    expect(result.written).toBe(true);
  });

  it('refuses to write a hardcoded secret env value into a .ts file', async () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    const path = join(dir, 'leaky.spec.ts');
    const result = await safeWrite(path, "const password = 'sup3rSecretPw';\n");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('TEST_PASSWORD');
    expect(result.reason).toContain('refusing to write a secret');
    vi.unstubAllEnvs();
  });

  it('refuses a hardcoded secret even with allowOverwrite: true', async () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    const path = join(dir, 'leaky.spec.ts');
    const result = await safeWrite(path, "const password = 'sup3rSecretPw';\n", { allowOverwrite: true });
    expect(result.ok).toBe(false);
    vi.unstubAllEnvs();
  });

  it('does not scan non-.ts files for secrets', async () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    const path = join(dir, 'notes.md');
    const result = await safeWrite(path, 'password is sup3rSecretPw\n');
    expect(result.ok).toBe(true);
    vi.unstubAllEnvs();
  });

  it('allows fake credentials that do not match a sensitive env var or secret pattern', async () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    const path = join(dir, 'auth.spec.ts');
    const result = await safeWrite(path, "const password = 'Test@1234';\nconst email = 'nonexistent@test.com';\n");
    expect(result.ok).toBe(true);
    expect(result.written).toBe(true);
    vi.unstubAllEnvs();
  });
});

// ── unifiedDiff ──────────────────────────────────────────────────────────────

describe('unifiedDiff', () => {
  it('returns empty string for identical content', () => {
    expect(unifiedDiff('same\n', 'same\n', 'f.ts')).toBe('');
  });

  it('formats a new file as all additions from /dev/null', () => {
    const diff = unifiedDiff('', 'one\ntwo', 'f.ts');
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ f.ts');
    expect(diff).toContain('+one');
    expect(diff).toContain('+two');
    expect(diff).toContain('@@ -0,0 +1,2 @@');
  });

  it('formats a modification with unified hunk markers', () => {
    const oldContent = 'a\nb\nc\nd\ne\n';
    const newContent = 'a\nb\nX\nd\ne\n';
    const diff = unifiedDiff(oldContent, newContent, 'f.ts');
    expect(diff).toContain('--- f.ts');
    expect(diff).toContain('+++ f.ts');
    expect(diff).toContain('-c');
    expect(diff).toContain('+X');
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });
});
