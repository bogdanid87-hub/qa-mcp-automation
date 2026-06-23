import { describe, it, expect } from 'vitest';
import { extractAssertingMethods, findNonAssertingTests } from '../tools/spec-checks';

describe('extractAssertingMethods', () => {
  it('flags methods that assert directly', () => {
    const pom = `export class P {
      async expectSuccess() { await expect(this.msg).toBeVisible(); }
      async fillForm(x) { await this.input.fill(x); }
    }`;
    const a = extractAssertingMethods([pom]);
    expect(a.has('expectSuccess')).toBe(true);
    expect(a.has('fillForm')).toBe(false);
  });

  it('resolves transitive assertions (goto → waitForLoaded → expect)', () => {
    const pom = `export class P {
      async goto() { await this.navigate('/'); await this.waitForLoaded(); }
      async waitForLoaded() { await expect(this.page).toHaveURL('/'); }
    }`;
    const a = extractAssertingMethods([pom]);
    expect(a.has('waitForLoaded')).toBe(true);
    expect(a.has('goto')).toBe(true); // asserts via waitForLoaded
  });
});

describe('findNonAssertingTests', () => {
  const asserting = new Set(['goto', 'expectSuccessMessage']);

  it('passes a test that asserts directly with expect()', () => {
    const spec = `test('a', async ({ page }) => { await expect(page).toHaveURL('/'); });`;
    expect(findNonAssertingTests(spec, asserting)).toEqual([]);
  });

  it('passes a test that asserts via an encapsulated POM method', () => {
    const spec = `test('b', async ({ contactPage }) => {
      await contactPage.submit();
      await contactPage.expectSuccessMessage();
    });`;
    expect(findNonAssertingTests(spec, asserting)).toEqual([]);
  });

  it('passes a test whose only call is a POM method that asserts internally (goto)', () => {
    const spec = `test('c', async ({ homePage }) => { await homePage.goto(); });`;
    expect(findNonAssertingTests(spec, asserting)).toEqual([]);
  });

  it('flags a test with no assertion anywhere', () => {
    const spec = `test('d navigates but never asserts', async ({ homePage }) => {
      await homePage.navigate('/');
      await homePage.clickProducts();
    });`;
    expect(findNonAssertingTests(spec, asserting)).toEqual(['d navigates but never asserts']);
  });

  it('does not treat test.describe as a test', () => {
    const spec = `test.describe('group', () => {
      test('real', async ({ page }) => { await expect(page).toBeTruthy(); });
    });`;
    expect(findNonAssertingTests(spec, asserting)).toEqual([]);
  });

  it('flags only the offending test among several', () => {
    const spec = `
      test('ok', async ({ page }) => { await expect(page).toHaveTitle(/x/); });
      test('bad', async ({ page }) => { await page.goto('/'); });
    `;
    // bare page.goto is not a POM asserting method; 'bad' has no assertion
    expect(findNonAssertingTests(spec, asserting)).toEqual(['bad']);
  });
});
