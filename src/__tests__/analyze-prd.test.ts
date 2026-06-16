import { describe, it, expect } from 'vitest';
import { buildCoverageList, buildSpecPrompt } from '../tools/analyze-prd';
import type { TestEntry, BrokenEntry } from '../tools/test-registry';

describe('buildCoverageList', () => {
  const passing: TestEntry[] = [
    { num: 1, spec: 'tests/ui/cart.spec.ts', describe: 'Cart', name: 'should add a product' },
    { num: 2, spec: 'tests/ui/auth.spec.ts', describe: 'Login', name: 'should login with valid credentials' },
  ];

  const broken: BrokenEntry[] = [
    {
      spec: 'tests/ui/auth.spec.ts',
      describe: 'Login',
      name: 'should show error for wrong password',
      kind: 'broken',
      rootCause: 'Locator changed',
    },
  ];

  it('lists passing tests in "describe › name" format', () => {
    const result = buildCoverageList(passing, []);
    expect(result).toContain('Cart › should add a product');
    expect(result).toContain('Login › should login with valid credentials');
  });

  it('lists broken tests alongside passing ones', () => {
    const result = buildCoverageList(passing, broken);
    expect(result).toContain('Login › should show error for wrong password');
  });

  it('includes backlog names with their annotation', () => {
    const result = buildCoverageList([], [], ['cart-empty-state', 'checkout-guest-flow']);
    expect(result).toContain('cart-empty-state (in gap backlog — already identified, not yet generated)');
    expect(result).toContain('checkout-guest-flow (in gap backlog — already identified, not yet generated)');
  });

  it('returns "No existing test coverage." when everything is empty', () => {
    expect(buildCoverageList([], [])).toBe('No existing test coverage.');
  });

  it('starts with the do-not-suggest header when tests exist', () => {
    const result = buildCoverageList(passing, []);
    expect(result).toMatch(/^Already covered or queued/);
  });

  it('backlog items are included even when passing/broken are empty', () => {
    const result = buildCoverageList([], [], ['some-gap']);
    expect(result).toContain('some-gap');
    expect(result).not.toBe('No existing test coverage.');
  });
});

describe('buildSpecPrompt', () => {
  const basicSpec = `
import { test, expect } from '@playwright/test';

describe('Cart', () => {
  test('should add product to cart', async ({ page }) => {});
  test('should remove product from cart', async ({ page }) => {});
  test('should show correct total', async ({ page }) => {});
});
`;

  it('uses the describe block name as the feature', () => {
    const result = buildSpecPrompt(basicSpec, 'tests/ui/cart.spec.ts');
    expect(result).toContain('Feature: Cart');
  });

  it('lists existing test names in the do-not-suggest section', () => {
    const result = buildSpecPrompt(basicSpec, 'tests/ui/cart.spec.ts');
    expect(result).toContain('- should add product to cart');
    expect(result).toContain('- should remove product from cart');
    expect(result).toContain('- should show correct total');
  });

  it('includes the spec file path in the source line', () => {
    const result = buildSpecPrompt(basicSpec, 'tests/ui/cart.spec.ts');
    expect(result).toContain('tests/ui/cart.spec.ts');
  });

  it('includes a suggestion prompt', () => {
    const result = buildSpecPrompt(basicSpec, 'tests/ui/cart.spec.ts');
    expect(result).toContain('Suggest additional test cases');
    expect(result).toContain('negative cases');
    expect(result).toContain('boundary conditions');
  });

  it('falls back to filename when no describe block is present', () => {
    const specWithoutDescribe = `
test('should do something', async ({ page }) => {});
`;
    const result = buildSpecPrompt(specWithoutDescribe, 'tests/ui/checkout.spec.ts');
    expect(result).toContain('Feature: checkout');
  });

  it('handles test.only and test.skip variants', () => {
    const specWithVariants = `
describe('Search', () => {
  test.only('should find products', async ({ page }) => {});
  test.skip('should handle empty results', async ({ page }) => {});
});
`;
    const result = buildSpecPrompt(specWithVariants, 'tests/ui/search.spec.ts');
    expect(result).toContain('- should find products');
    expect(result).toContain('- should handle empty results');
  });

  it('returns a non-empty string for an empty spec', () => {
    const result = buildSpecPrompt('', 'tests/ui/empty.spec.ts');
    expect(result).toContain('Feature:');
    expect(result).toContain('Suggest additional test cases');
  });
});
