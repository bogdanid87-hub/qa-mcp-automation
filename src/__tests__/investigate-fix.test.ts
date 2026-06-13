import { describe, it, expect } from 'vitest';
import { extractIntentSignatures, describeIntentViolation, failureSignature, autoFixFailure } from '../tools/investigate-fix';
import { TokenBudget } from '../tools/budget';

describe('extractIntentSignatures', () => {
  it('maps each test() title to its sorted assertion-chain signature', () => {
    const content = `
test.describe('Cart', () => {
  test('adds item', async ({ page }) => {
    await expect(page.locator('.cart')).toBeVisible();
  });

  test.skip('removes item', async ({ page }) => {
    await expect(page.locator('.empty')).toHaveCount(0);
  });
});
`;
    const sigs = extractIntentSignatures(content);
    expect(sigs.get('adds item')).toEqual(['.toBeVisible()']);
    expect(sigs.get('removes item')).toEqual(['.toHaveCount(0)']);
  });

  it('excludes test.describe() blocks', () => {
    const content = `
test.describe('Cart', () => {
  test('adds item', async ({ page }) => {
    await expect(page.locator('.cart')).toBeVisible();
  });
});
`;
    const sigs = extractIntentSignatures(content);
    expect(sigs.has('Cart')).toBe(false);
    expect(sigs.has('adds item')).toBe(true);
  });

  it('captures multiple assertions per test in sorted order', () => {
    const content = `
test('validates form', async ({ page }) => {
  await expect(page.locator('.success')).toBeHidden();
  await expect(page.locator('.error')).toBeVisible();
});
`;
    const sigs = extractIntentSignatures(content);
    expect(sigs.get('validates form')).toEqual(['.toBeHidden()', '.toBeVisible()']);
  });

  it('parses a multi-line expect chain the same as a single-line equivalent', () => {
    const singleLine = `
test('multi line', async ({ page }) => {
  await expect(page.locator('.x')).toBeVisible();
});
`;
    const multiLine = `
test('multi line', async ({ page }) => {
  await expect(page.locator('.x'))
    .toBeVisible();
});
`;
    expect(extractIntentSignatures(multiLine).get('multi line'))
      .toEqual(extractIntentSignatures(singleLine).get('multi line'));
  });
});

describe('describeIntentViolation', () => {
  it('returns null when only the expect() subject (locator) changes', () => {
    const before = `
test('shows title', async ({ page }) => {
  await expect(page.locator('#old-id')).toBeVisible();
});
`;
    const after = `
test('shows title', async ({ page }) => {
  await expect(page.locator('[data-qa="title"]')).toBeVisible();
});
`;
    expect(describeIntentViolation(before, after)).toBeNull();
  });

  it('blocks a fix that weakens an assertion', () => {
    const before = `
test('has five items', async ({ page }) => {
  const count = await page.locator('.item').count();
  expect(count).toBe(5);
});
`;
    const after = `
test('has five items', async ({ page }) => {
  const count = await page.locator('.item').count();
  expect(count).toBeGreaterThan(0);
});
`;
    const violation = describeIntentViolation(before, after);
    expect(violation).not.toBeNull();
    expect(violation).toContain('has five items');
    expect(violation).toContain('.toBe(5)');
    expect(violation).toContain('.toBeGreaterThan(0)');
  });

  it('blocks a fix that removes an assertion from an existing test', () => {
    const before = `
test('validates form', async ({ page }) => {
  await expect(page.locator('.error')).toBeVisible();
  await expect(page.locator('.success')).toBeHidden();
});
`;
    const after = `
test('validates form', async ({ page }) => {
  await expect(page.locator('.error')).toBeVisible();
});
`;
    const violation = describeIntentViolation(before, after);
    expect(violation).not.toBeNull();
    expect(violation).toContain('validates form');
  });

  it('does not report tests that only exist in one version', () => {
    const before = `
test('old test', async ({ page }) => {
  await expect(page.locator('.a')).toBeVisible();
});
`;
    const after = `
test('old test', async ({ page }) => {
  await expect(page.locator('.a')).toBeVisible();
});

test('new test', async ({ page }) => {
  await expect(page.locator('.b')).toBeHidden();
});
`;
    expect(describeIntentViolation(before, after)).toBeNull();
  });

  it('returns null when nothing changes', () => {
    const spec = `
test('adds item', async ({ page }) => {
  await expect(page.locator('.cart')).toBeVisible();
});
`;
    expect(describeIntentViolation(spec, spec)).toBeNull();
  });
});

// ── failureSignature ────────────────────────────────────────────────────────

describe('failureSignature', () => {
  const baseFailure = [
    '✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)',
    '',
    '  1) [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product',
    '',
    '    Error: Timed out 5000ms waiting for expect(locator).toBeVisible()',
    '',
    "    Locator: locator('.cart-item')",
    '    Expected: visible',
    '    Received: hidden',
  ].join('\n');

  it('is identical for the exact same output', () => {
    expect(failureSignature(baseFailure)).toBe(failureSignature(baseFailure));
  });

  it('ignores cosmetic differences — durations, ANSI codes, artifact paths', () => {
    const cosmeticVariant = [
      '✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (823ms)',
      '',
      '  1) [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product',
      '',
      '    Error: \x1B[31mTimed out 7321ms waiting for expect(locator).toBeVisible()\x1B[39m',
      '',
      "    Locator: locator('.cart-item')",
      '    Expected: visible',
      '    Received: hidden',
      '',
      '    attachment #1: screenshot (image/png) ───',
      '    test-results/cart-should-add-a-product/test-failed-1.png',
    ].join('\n');

    expect(failureSignature(cosmeticVariant)).toBe(failureSignature(baseFailure));
  });

  it('changes when the error detail changes', () => {
    const differentError = [
      '✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)',
      '',
      '  1) [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product',
      '',
      '    Error: expect(received).toBe(expected)',
      '',
      '    Expected: 5',
      '    Received: 3',
    ].join('\n');

    expect(failureSignature(differentError)).not.toBe(failureSignature(baseFailure));
  });

  it('changes when a different test fails', () => {
    const differentTest = baseFailure
      .replace('should add a product', 'should remove a product');

    expect(failureSignature(differentTest)).not.toBe(failureSignature(baseFailure));
  });

  it('is independent of the order failing tests appear in', () => {
    const a = [
      '✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)',
      '✗  2 [chromium] › tests/ui/search.spec.ts:8:3 › Search › should filter results (300ms)',
    ].join('\n');
    const b = [
      '✗  1 [chromium] › tests/ui/search.spec.ts:8:3 › Search › should filter results (300ms)',
      '✗  2 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)',
    ].join('\n');

    expect(failureSignature(a)).toBe(failureSignature(b));
  });
});

// ── autoFixFailure — early returns (no API call) ──────────────────────────────

describe('autoFixFailure early returns', () => {
  const baseFailure = [
    '✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)',
    '',
    '  1) [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product',
    '',
    '    Error: Timed out 5000ms waiting for expect(locator).toBeVisible()',
    '',
    "    Locator: locator('.cart-item')",
    '    Expected: visible',
    '    Received: hidden',
  ].join('\n');

  it('stops with noProgress when the signature matches the previous attempt', async () => {
    const previousSignature = failureSignature(baseFailure);
    const result = await autoFixFailure(baseFailure, undefined, undefined, previousSignature);

    expect(result.noProgress).toBe(true);
    expect(result.verdict).toBe('unclear');
    expect(result.budgetExceeded).toBe(false);
    expect(result.signature).toBe(previousSignature);
  });

  it('aborts with budgetExceeded before calling Claude when the pre-flight estimate exceeds the budget', async () => {
    // No parseable failing tests and no `pattern` ⇒ the retry pre-check
    // (which would shell out to `runTests`) is skipped, so this stays
    // network/Playwright-free.
    const output = 'Build failed: something went wrong with no Playwright markers';
    const budget = new TokenBudget(0.000001); // any real call blows past this

    const result = await autoFixFailure(output, undefined, budget);

    expect(result.budgetExceeded).toBe(true);
    expect(result.noProgress).toBe(false);
    expect(result.fixed).toBe(false);
    expect(result.signature).toBe(failureSignature(output));
  });
});
