import { describe, it, expect } from 'vitest';
import { buildCoverageList } from '../tools/analyze-prd';
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
