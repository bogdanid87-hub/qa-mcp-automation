import { describe, it, expect } from 'vitest';
import { prefixForSpec, ID_COMMENT_RE } from '../tools/tag-tests';

describe('prefixForSpec', () => {
  it('returns API for tests/api/ specs', () => {
    expect(prefixForSpec('tests/api/products.spec.ts')).toBe('API');
  });

  it('returns E2E for tests/e2e/ specs', () => {
    expect(prefixForSpec('tests/e2e/checkout.spec.ts')).toBe('E2E');
  });

  it('returns Visual for tests/visual/ specs', () => {
    expect(prefixForSpec('tests/visual/cart.spec.ts')).toBe('Visual');
  });

  it('returns UI for tests/ui/ specs', () => {
    expect(prefixForSpec('tests/ui/cart.spec.ts')).toBe('UI');
  });

  it('defaults to UI for unknown paths', () => {
    expect(prefixForSpec('tests/other/foo.spec.ts')).toBe('UI');
  });
});

describe('ID_COMMENT_RE', () => {
  it('matches a standard UI comment', () => {
    expect(ID_COMMENT_RE.test('// [UI Cart #1]')).toBe(true);
  });

  it('matches an API comment', () => {
    expect(ID_COMMENT_RE.test('// [API Products #5]')).toBe(true);
  });

  it('matches an E2E comment with a multi-word describe', () => {
    expect(ID_COMMENT_RE.test('// [E2E Place Order #3]')).toBe(true);
  });

  it('matches a Visual comment', () => {
    expect(ID_COMMENT_RE.test('// [Visual Cart Page — Table Structure #1]')).toBe(true);
  });

  it('matches with leading whitespace / indentation', () => {
    expect(ID_COMMENT_RE.test('    // [UI Cart #1]')).toBe(true);
  });

  it('does not match a regular comment', () => {
    expect(ID_COMMENT_RE.test('// This is a regular comment')).toBe(false);
  });

  it('does not match a partial comment missing the closing bracket', () => {
    expect(ID_COMMENT_RE.test('// [UI Cart #1')).toBe(false);
  });

  it('does not match code lines', () => {
    expect(ID_COMMENT_RE.test("test('should add a product', async () => {")).toBe(false);
  });
});
