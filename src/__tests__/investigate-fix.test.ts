import { describe, it, expect } from 'vitest';
import { extractIntentSignatures, describeIntentViolation } from '../tools/investigate-fix';

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
