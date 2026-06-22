import { describe, it, expect } from 'vitest';
import { detectVisualIntent, detectApiIntent } from '../tools/generate-test';

// These two functions route EVERY generate_test call to the ui / api / e2e / visual
// path. They're pure (description + optional spec_file → boolean) but were previously
// untested — a silent regression here mis-routes generation (e.g. an API test rendered
// with a browser, or a visual test in the wrong folder). spec_file is matched via
// specKind(), which reads config.testing.folders (tests/api, tests/visual here).

describe('detectVisualIntent', () => {
  it('is true when the spec_file is under the visual folder', () => {
    expect(detectVisualIntent('whatever', 'tests/visual/cart.spec.ts')).toBe(true);
  });

  it('is true for explicit visual-regression language', () => {
    expect(detectVisualIntent('Add a visual regression test for the nav bar')).toBe(true);
    expect(detectVisualIntent('a visual snapshot of the homepage')).toBe(true);
    expect(detectVisualIntent('assert toHaveScreenshot of the header')).toBe(true);
    expect(detectVisualIntent('capture the layout of the products grid')).toBe(true);
    expect(detectVisualIntent('capture the appearance of the footer')).toBe(true);
  });

  it('is false for an ordinary UI description', () => {
    expect(detectVisualIntent('search for a product and verify results')).toBe(false);
    expect(detectVisualIntent('log in with valid credentials')).toBe(false);
  });

  it('does not fire on the bare word "visual" without a visual-test phrase', () => {
    expect(detectVisualIntent('verify the visual indicator turns green')).toBe(false);
  });

  it('a UI spec_file does not force visual', () => {
    expect(detectVisualIntent('check the cart', 'tests/ui/cart.spec.ts')).toBe(false);
  });
});

describe('detectApiIntent', () => {
  it('is true when the spec_file is under the api folder', () => {
    expect(detectApiIntent('whatever', 'tests/api/products.spec.ts')).toBe(true);
  });

  it('is true when the spec_file path merely contains /api/', () => {
    expect(detectApiIntent('whatever', 'custom/api/products.spec.ts')).toBe(true);
  });

  it('is true for explicit API-test language', () => {
    expect(detectApiIntent('Write an API test for the products list')).toBe(true);
    expect(detectApiIntent('test the api for brands')).toBe(true);
    expect(detectApiIntent('hit the products api endpoint')).toBe(true);
  });

  it('is true for an HTTP method + path pattern', () => {
    expect(detectApiIntent('POST /api/verifyLogin with valid credentials')).toBe(true);
    expect(detectApiIntent('GET /products/list returns 200')).toBe(true);
  });

  it('is true for request-fixture / no-browser language', () => {
    expect(detectApiIntent('use the request fixture to call the endpoint')).toBe(true);
    expect(detectApiIntent('check the response with no browser')).toBe(true);
    expect(detectApiIntent('a rest api check of the catalogue')).toBe(true);
  });

  it('stays conservative — an ordinary UI flow is NOT an API test', () => {
    expect(detectApiIntent('click the login button and verify the account page')).toBe(false);
    expect(detectApiIntent('add two products to the cart and check the total')).toBe(false);
    // "verify against the API" is a UI test that cross-checks — not a pure API test
    expect(detectApiIntent('add to cart and verify the count matches the backend')).toBe(false);
  });

  it('a UI spec_file alone does not force API', () => {
    expect(detectApiIntent('check the cart', 'tests/ui/cart.spec.ts')).toBe(false);
  });
});
