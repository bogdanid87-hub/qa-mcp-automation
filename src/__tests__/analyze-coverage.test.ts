import { describe, it, expect } from 'vitest';
import { extractRegistrySection } from '../tools/analyze-coverage';

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
