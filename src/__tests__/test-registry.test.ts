import { describe, it, expect } from 'vitest';
import {
  parsePassingTests,
  parseFailingTestsFromOutput,
  normalizeTestName,
  extractReqIds,
  deriveRisk,
  registryForSpec,
  parseTestCases,
  parseBrokenTests,
  buildContent,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
} from '../tools/test-registry';

// ── parsePassingTests ──────────────────────────────────────────────────────────

describe('parsePassingTests', () => {
  it('parses a standard passing test line', () => {
    const output = '  ✓  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (1234ms)';
    const results = parsePassingTests(output);
    expect(results).toHaveLength(1);
    expect(results[0].spec).toBe('tests/ui/cart.spec.ts');
    expect(results[0].title).toBe('Cart › should add a product');
  });

  it('parses multiple passing tests', () => {
    const output = [
      '  ✓  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (100ms)',
      '  ✓  2 [chromium] › tests/ui/contact.spec.ts:8:5 › Contact › should submit the form (200ms)',
    ].join('\n');
    expect(parsePassingTests(output)).toHaveLength(2);
  });

  it('returns empty array for output with no passing tests', () => {
    expect(parsePassingTests('no tests here')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parsePassingTests('')).toHaveLength(0);
  });
});

// ── parseFailingTestsFromOutput ────────────────────────────────────────────────

describe('parseFailingTestsFromOutput', () => {
  it('parses an inline ✗ marker', () => {
    const output = '  ✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)';
    const results = parseFailingTestsFromOutput(output);
    expect(results).toHaveLength(1);
    expect(results[0].spec).toBe('tests/ui/cart.spec.ts');
    expect(results[0].describe).toBe('Cart');
    expect(results[0].name).toBe('should add a product');
  });

  it('parses a numbered failure block entry', () => {
    const output = '  1) [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product';
    const results = parseFailingTestsFromOutput(output);
    expect(results).toHaveLength(1);
    expect(results[0].describe).toBe('Cart');
    expect(results[0].name).toBe('should add a product');
  });

  it('deduplicates tests appearing in both inline and numbered sections', () => {
    const output = [
      '  ✗  1 [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product (500ms)',
      '  1) [chromium] › tests/ui/cart.spec.ts:12:5 › Cart › should add a product',
    ].join('\n');
    expect(parseFailingTestsFromOutput(output)).toHaveLength(1);
  });

  it('returns empty array when there are no failures', () => {
    expect(parseFailingTestsFromOutput('All tests passed')).toHaveLength(0);
  });
});

// ── normalizeTestName ─────────────────────────────────────────────────────────

describe('normalizeTestName', () => {
  it('lowercases the name', () => {
    expect(normalizeTestName('Should Add Product')).toBe('should add product');
  });

  it('removes article "a"', () => {
    expect(normalizeTestName('should place a order')).toBe('should place order');
  });

  it('removes article "an"', () => {
    expect(normalizeTestName('should place an order')).toBe('should place order');
  });

  it('removes article "the"', () => {
    expect(normalizeTestName('should load the page')).toBe('should load page');
  });

  it('collapses punctuation to spaces', () => {
    expect(normalizeTestName('should add product — to cart')).toBe('should add product to cart');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeTestName('should  add   product')).toBe('should add product');
  });

  it('makes "should place an order" and "should place order" compare equal', () => {
    expect(normalizeTestName('should place an order')).toBe(normalizeTestName('should place order'));
  });
});

// ── extractReqIds ──────────────────────────────────────────────────────────────

describe('extractReqIds', () => {
  it('extracts a @req: tag among other tags', () => {
    expect(extractReqIds('should add product to cart @smoke @critical @req:REQ-API-005')).toEqual(['REQ-API-005']);
  });

  it('returns an empty array when no @req: tag is present', () => {
    expect(extractReqIds('should add product to cart @smoke @critical')).toEqual([]);
  });

  it('extracts multiple @req: tags', () => {
    expect(extractReqIds('should do two things @req:REQ-001 @req:REQ-API-002')).toEqual(['REQ-001', 'REQ-API-002']);
  });
});

// ── deriveRisk ────────────────────────────────────────────────────────────────

describe('deriveRisk', () => {
  it('returns critical for checkout flows', () => {
    expect(deriveRisk('tests/e2e/place-order.spec.ts', 'Place Order')).toBe('critical');
  });

  it('returns critical for payment-related describes', () => {
    expect(deriveRisk('tests/e2e/checkout.spec.ts', 'Payment')).toBe('critical');
  });

  it('returns high for login flows', () => {
    expect(deriveRisk('tests/ui/auth.spec.ts', 'Login')).toBe('high');
  });

  it('returns high for account management', () => {
    expect(deriveRisk('tests/ui/account.spec.ts', 'Account')).toBe('high');
  });

  it('returns medium for cart operations', () => {
    expect(deriveRisk('tests/ui/cart.spec.ts', 'Cart')).toBe('medium');
  });

  it('returns medium for product search', () => {
    expect(deriveRisk('tests/ui/search.spec.ts', 'Search')).toBe('medium');
  });

  it('returns low for contact/newsletter', () => {
    expect(deriveRisk('tests/ui/contact.spec.ts', 'Contact Us Form')).toBe('low');
  });

  it('returns low for subscription (no medium keywords)', () => {
    expect(deriveRisk('tests/ui/subscription.spec.ts', 'Newsletter Subscription')).toBe('low');
  });
});

// ── registryForSpec ────────────────────────────────────────────────────────────

describe('registryForSpec', () => {
  it('routes tests/api/ to TESTS_API_PATH', () => {
    expect(registryForSpec('tests/api/products.spec.ts')).toBe(TESTS_API_PATH);
  });

  it('routes tests/e2e/ to TESTS_E2E_PATH', () => {
    expect(registryForSpec('tests/e2e/checkout.spec.ts')).toBe(TESTS_E2E_PATH);
  });

  it('routes tests/visual/ to TESTS_VISUAL_PATH', () => {
    expect(registryForSpec('tests/visual/cart.spec.ts')).toBe(TESTS_VISUAL_PATH);
  });

  it('routes tests/ui/ to TESTS_UI_PATH', () => {
    expect(registryForSpec('tests/ui/cart.spec.ts')).toBe(TESTS_UI_PATH);
  });

  it('defaults to TESTS_UI_PATH for unknown prefixes', () => {
    expect(registryForSpec('tests/other/foo.spec.ts')).toBe(TESTS_UI_PATH);
  });
});

// ── parseTestCases ─────────────────────────────────────────────────────────────

const SAMPLE_REGISTRY = `# Test Cases

**Total: 2 tests**

---

## tests/ui/cart.spec.ts

### Cart

| # | Test |
|---|------|
| 1 | should add a product to the cart |
| 2 | should remove a product from the cart |

`;

describe('parseTestCases', () => {
  it('parses spec, describe, and test name', () => {
    const entries = parseTestCases(SAMPLE_REGISTRY);
    expect(entries).toHaveLength(2);
    expect(entries[0].spec).toBe('tests/ui/cart.spec.ts');
    expect(entries[0].describe).toBe('Cart');
    expect(entries[0].name).toBe('should add a product to the cart');
  });

  it('assigns sequential numbers', () => {
    const entries = parseTestCases(SAMPLE_REGISTRY);
    expect(entries[0].num).toBe(1);
    expect(entries[1].num).toBe(2);
  });

  it('returns empty array for empty content', () => {
    expect(parseTestCases('')).toHaveLength(0);
  });

  it('handles multiple specs in one registry', () => {
    const content = `# Test Cases\n\n## tests/ui/cart.spec.ts\n\n### Cart\n\n| # | Test |\n|---|------|\n| 1 | should add |\n\n## tests/ui/contact.spec.ts\n\n### Contact\n\n| # | Test |\n|---|------|\n| 1 | should submit |\n\n`;
    const entries = parseTestCases(content);
    expect(entries.map(e => e.spec)).toEqual(['tests/ui/cart.spec.ts', 'tests/ui/contact.spec.ts']);
  });
});

// ── parseBrokenTests ──────────────────────────────────────────────────────────

const BROKEN_REGISTRY = `# Test Cases

---

## ⚠️ Application Bugs

> These tests are correct — the application has a defect.

| Risk | Spec | Describe | Test | Root cause | Actual behaviour |
|------|------|----------|------|------------|-----------------|
| high | tests/ui/auth.spec.ts | Login | should login with valid credentials | App returns 500 | Error page shown |

---

## ❌ Broken Tests

> Fix manually or run: \`npm run fix\`

| Risk | Spec | Describe | Test | Root cause |
|------|------|----------|------|------------|
| medium | tests/ui/cart.spec.ts | Cart | should add a product | Locator changed |

`;

describe('parseBrokenTests', () => {
  it('parses app_bug entries', () => {
    const entries = parseBrokenTests(BROKEN_REGISTRY);
    const appBug = entries.find(e => e.kind === 'app_bug');
    expect(appBug).toBeDefined();
    expect(appBug!.spec).toBe('tests/ui/auth.spec.ts');
    expect(appBug!.describe).toBe('Login');
    expect(appBug!.risk).toBe('high');
    expect(appBug!.actualBehavior).toBe('Error page shown');
  });

  it('parses broken test entries', () => {
    const entries = parseBrokenTests(BROKEN_REGISTRY);
    const broken = entries.find(e => e.kind === 'broken');
    expect(broken).toBeDefined();
    expect(broken!.spec).toBe('tests/ui/cart.spec.ts');
    expect(broken!.risk).toBe('medium');
  });

  it('returns empty array for content with no broken sections', () => {
    expect(parseBrokenTests(SAMPLE_REGISTRY)).toHaveLength(0);
  });

  it('returns empty array for empty content', () => {
    expect(parseBrokenTests('')).toHaveLength(0);
  });
});

// ── buildContent ──────────────────────────────────────────────────────────────

describe('buildContent', () => {
  it('builds a well-formed registry from entries', () => {
    const entries = [
      { num: 1, spec: 'tests/ui/cart.spec.ts', describe: 'Cart', name: 'should add a product' },
    ];
    const content = buildContent(entries);
    expect(content).toContain('## tests/ui/cart.spec.ts');
    expect(content).toContain('### Cart');
    expect(content).toContain('should add a product');
  });

  it('shows total test count', () => {
    const entries = [
      { num: 1, spec: 'tests/ui/cart.spec.ts', describe: 'Cart', name: 'should add a product' },
      { num: 2, spec: 'tests/ui/cart.spec.ts', describe: 'Cart', name: 'should remove a product' },
    ];
    expect(buildContent(entries)).toContain('**Total: 2 tests**');
  });

  it('shows total: 0 for empty entries', () => {
    expect(buildContent([])).toContain('**Total: 0 passing tests**');
  });

  it('sorts broken entries by risk (critical first)', () => {
    const broken = [
      { spec: 'tests/ui/contact.spec.ts', describe: 'Contact', name: 'low test', kind: 'broken' as const, rootCause: 'x', risk: 'low' as const },
      { spec: 'tests/e2e/checkout.spec.ts', describe: 'Checkout', name: 'critical test', kind: 'broken' as const, rootCause: 'y', risk: 'critical' as const },
    ];
    const content = buildContent([], broken);
    const criticalPos = content.indexOf('critical test');
    const lowPos = content.indexOf('low test');
    expect(criticalPos).toBeLessThan(lowPos);
  });

  it('sanitizes pipe characters in test names', () => {
    const entries = [
      { num: 1, spec: 'tests/ui/cart.spec.ts', describe: 'Cart', name: 'should add product | to cart' },
    ];
    const content = buildContent(entries);
    expect(content).not.toMatch(/\| should add product \| to cart \|/);
    expect(content).toContain('should add product – to cart');
  });
});
