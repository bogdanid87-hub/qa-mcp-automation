import { describe, it, expect } from 'vitest';
import { extractRegistrySection, buildReport } from '../tools/analyze-coverage';

const REGISTRY = `# Test Cases

---

## tests/ui/cart.spec.ts

### Cart

| # | Test |
|---|------|
| 1 | should add a product |
| 2 | should remove a product |

---

## tests/ui/contact.spec.ts

### Contact Us Form

| # | Test |
|---|------|
| 1 | should submit the form |

`;

describe('extractRegistrySection', () => {
  it('extracts the section for an existing spec', () => {
    const section = extractRegistrySection(REGISTRY, 'tests/ui/cart.spec.ts');
    expect(section).toContain('## tests/ui/cart.spec.ts');
    expect(section).toContain('should add a product');
    expect(section).toContain('should remove a product');
  });

  it('does not bleed into the next spec section', () => {
    const section = extractRegistrySection(REGISTRY, 'tests/ui/cart.spec.ts');
    expect(section).not.toContain('tests/ui/contact.spec.ts');
    expect(section).not.toContain('should submit the form');
  });

  it('extracts the last section correctly (no following ## header)', () => {
    const section = extractRegistrySection(REGISTRY, 'tests/ui/contact.spec.ts');
    expect(section).toContain('should submit the form');
    expect(section).not.toContain('should add a product');
  });

  it('returns a not-found message for an unknown spec', () => {
    const result = extractRegistrySection(REGISTRY, 'tests/ui/nonexistent.spec.ts');
    expect(result).toContain('no registry entries found');
    expect(result).toContain('tests/ui/nonexistent.spec.ts');
  });

  it('returns not-found for empty content', () => {
    expect(extractRegistrySection('', 'tests/ui/cart.spec.ts')).toContain('no registry entries found');
  });
});

describe('buildReport', () => {
  const minimalResult = {
    summary: 'Summary text',
    covered_well: [],
    covered_partially: [],
    gaps: [],
    priority_summary: {},
    recommendations: 'Recommendations text',
  };

  it('omits the Requirements coverage section when reqCoverage is not provided', () => {
    const report = buildReport(minimalResult, 'all registries');
    expect(report).not.toContain('Requirements coverage');
  });

  it('omits the Requirements coverage section when reqCoverage is null', () => {
    const report = buildReport(minimalResult, 'all registries', null);
    expect(report).not.toContain('Requirements coverage');
  });

  it('shows an all-covered message when there are no uncovered requirements', () => {
    const report = buildReport(minimalResult, 'all registries', { total: 12, covered: 12, uncovered: [], functionalOnly: [] });
    expect(report).toContain('## Requirements coverage (deterministic)');
    expect(report).toContain('REQUIREMENTS.md: 12/12 requirements covered by at least one test. ✅');
  });

  it('lists uncovered requirements with counts and ids', () => {
    const reqCoverage = {
      total: 5,
      covered: 3,
      uncovered: [
        { id: 'REQ-API-009', text: 'POST to checkout returns 402 when payment fails' },
        { id: 'REQ-UI-003', text: 'Cart shows empty state message' },
      ],
      functionalOnly: [],
    };
    const report = buildReport(minimalResult, 'all registries', reqCoverage);
    expect(report).toContain('## Requirements coverage (deterministic)');
    expect(report).toContain('REQUIREMENTS.md: 3/5 requirements covered by at least one test (2 gaps)');
    expect(report).toContain('- REQ-API-009: POST to checkout returns 402 when payment fails');
    expect(report).toContain('- REQ-UI-003: Cart shows empty state message');
  });

  it('uses singular "gap" for exactly one uncovered requirement', () => {
    const reqCoverage = {
      total: 4,
      covered: 3,
      uncovered: [{ id: 'REQ-005', text: 'Single uncovered requirement' }],
      functionalOnly: [],
    };
    const report = buildReport(minimalResult, 'all registries', reqCoverage);
    expect(report).toContain('(1 gap)');
  });

  it('omits the functional-only section when there are none', () => {
    const reqCoverage = { total: 5, covered: 5, uncovered: [], functionalOnly: [] };
    const report = buildReport(minimalResult, 'all registries', reqCoverage);
    expect(report).not.toContain('Covered by functional tests only');
  });

  it('lists functional-only requirements with counts and ids', () => {
    const reqCoverage = {
      total: 5,
      covered: 5,
      uncovered: [],
      functionalOnly: [
        { id: 'REQ-API-005', text: 'POST to search_product returns matching results' },
        { id: 'REQ-004', text: 'Registering with a used email shows an error' },
      ],
    };
    const report = buildReport(minimalResult, 'all registries', reqCoverage);
    expect(report).toContain('**Covered by functional tests only** (no @negative/@boundary test yet — 2):');
    expect(report).toContain('- REQ-API-005: POST to search_product returns matching results');
    expect(report).toContain('- REQ-004: Registering with a used email shows an error');
  });
});
