import { describe, it, expect, vi, afterEach } from 'vitest';
import { scanForSecrets } from '../lib/scan-secrets';

describe('scanForSecrets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('flags the literal value of TEST_PASSWORD if it appears in content', () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    const matches = scanForSecrets("await page.fill('#password', 'sup3rSecretPw');");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toContain('TEST_PASSWORD');
  });

  it('flags the literal value of TEST_EMAIL if it appears in content', () => {
    vi.stubEnv('TEST_EMAIL', 'real.user@example.com');
    const matches = scanForSecrets("await page.fill('#email', 'real.user@example.com');");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toContain('TEST_EMAIL');
  });

  it('flags the literal value of ANTHROPIC_API_KEY if it appears in content', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-totally-real-key-value');
    const matches = scanForSecrets("const key = 'sk-ant-totally-real-key-value';");
    // Also matches the generic sk-ant- pattern, so allow >= 1.
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.label.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  it('does not flag intentional fake credentials used in the test suite', () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    vi.stubEnv('TEST_EMAIL', 'real.user@example.com');
    const matches = scanForSecrets(
      "password: 'Test@1234', email: 'qa.tester.fixed@testmail.com', email2: 'nonexistent@test.com'",
    );
    expect(matches).toHaveLength(0);
  });

  it('ignores env values shorter than the minimum length', () => {
    vi.stubEnv('TEST_PASSWORD', 'ab');
    const matches = scanForSecrets("const short = 'ab';");
    expect(matches).toHaveLength(0);
  });

  it('is a no-op when the env var is unset', () => {
    const matches = scanForSecrets("const password = 'whatever-was-in-this-string';");
    expect(matches).toHaveLength(0);
  });

  it('flags an Anthropic-style API key regardless of env', () => {
    const matches = scanForSecrets("const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';");
    expect(matches.some((m) => m.label.includes('API key'))).toBe(true);
  });

  it('flags an AWS access key id', () => {
    const matches = scanForSecrets('const id = "AKIAABCDEFGHIJKLMNOP";');
    expect(matches.some((m) => m.label.includes('AWS'))).toBe(true);
  });

  it('flags a GitHub token', () => {
    const matches = scanForSecrets(`const token = 'ghp_${'a'.repeat(36)}';`);
    expect(matches.some((m) => m.label.includes('GitHub'))).toBe(true);
  });

  it('flags a PEM private key header', () => {
    const matches = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----');
    expect(matches.some((m) => m.label.includes('private key'))).toBe(true);
  });

  it('returns an empty array for ordinary generated spec content', () => {
    const matches = scanForSecrets(`import { test, expect } from '../../fixtures';

test.describe('Cart', () => {
  test('should add a product', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.product')).toBeVisible();
  });
});
`);
    expect(matches).toHaveLength(0);
  });

  it('redacts matched values in the excerpt', () => {
    vi.stubEnv('TEST_PASSWORD', 'sup3rSecretPw');
    const matches = scanForSecrets("const password = 'sup3rSecretPw';");
    expect(matches[0].excerpt).not.toContain('Secret');
    expect(matches[0].excerpt).toBe('sup...tPw');
  });
});
