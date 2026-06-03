import { describe, it, expect } from 'vitest';
import { parseFileMetadata, parseMultipleSections } from '../tools/cli-parsers';

describe('parseFileMetadata', () => {
  it('extracts test_name directive', () => {
    const raw = '# test_name: login-happy-path\nShould log in with valid credentials.';
    const result = parseFileMetadata(raw);
    expect(result.testName).toBe('login-happy-path');
    expect(result.description).toBe('Should log in with valid credentials.');
  });

  it('extracts spec_file directive', () => {
    const raw = '# spec_file: tests/ui/auth.spec.ts\nShould log in.';
    expect(parseFileMetadata(raw).specFile).toBe('tests/ui/auth.spec.ts');
  });

  it('extracts page_paths directive as an array', () => {
    const raw = '# page_paths: /login, /\nShould log in.';
    expect(parseFileMetadata(raw).pagePaths).toEqual(['/login', '/']);
  });

  it('strips other comment lines from description', () => {
    const raw = '# This is just a comment\nActual description.';
    const result = parseFileMetadata(raw);
    expect(result.description).toBe('Actual description.');
    expect(result.testName).toBeUndefined();
  });

  it('returns the full description when no directives are present', () => {
    const raw = 'Should submit the contact form successfully.';
    const result = parseFileMetadata(raw);
    expect(result.description).toBe('Should submit the contact form successfully.');
    expect(result.testName).toBeUndefined();
    expect(result.specFile).toBeUndefined();
  });

  it('handles multiple directives and multi-line descriptions', () => {
    const raw = [
      '# test_name: cart-add',
      '# spec_file: tests/ui/cart.spec.ts',
      '# page_paths: /products, /cart',
      '',
      'Navigate to products.',
      'Click Add to Cart.',
    ].join('\n');
    const result = parseFileMetadata(raw);
    expect(result.testName).toBe('cart-add');
    expect(result.specFile).toBe('tests/ui/cart.spec.ts');
    expect(result.pagePaths).toEqual(['/products', '/cart']);
    expect(result.description).toContain('Navigate to products.');
    expect(result.description).toContain('Click Add to Cart.');
  });

  it('is case-insensitive for directive keys', () => {
    const raw = '# TEST_NAME: my-test\nDescription.';
    expect(parseFileMetadata(raw).testName).toBe('my-test');
  });
});

describe('parseMultipleSections', () => {
  it('returns empty array for a single section', () => {
    const raw = '# test_name: foo\nOnly one test here.';
    expect(parseMultipleSections(raw)).toHaveLength(0);
  });

  it('splits on --- separators', () => {
    const raw = [
      '# test_name: test-one',
      'First test description.',
      '---',
      '# test_name: test-two',
      'Second test description.',
    ].join('\n');
    const sections = parseMultipleSections(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0].testName).toBe('test-one');
    expect(sections[1].testName).toBe('test-two');
  });

  it('splits on ---- (four dashes) separators', () => {
    const raw = 'First test.\n----\nSecond test.';
    expect(parseMultipleSections(raw)).toHaveLength(2);
  });

  it('returns empty array when content is empty', () => {
    expect(parseMultipleSections('')).toHaveLength(0);
  });

  it('parses each section through parseFileMetadata', () => {
    const raw = [
      '# spec_file: tests/ui/a.spec.ts',
      'Description A.',
      '---',
      '# spec_file: tests/ui/b.spec.ts',
      'Description B.',
    ].join('\n');
    const sections = parseMultipleSections(raw);
    expect(sections[0].specFile).toBe('tests/ui/a.spec.ts');
    expect(sections[1].specFile).toBe('tests/ui/b.spec.ts');
  });
});
