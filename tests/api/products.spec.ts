import { test, expect } from '../../fixtures';
import type { APIResponse } from '@playwright/test';

const PRODUCTS_ENDPOINT = '/api/productsList';
const BRANDS_ENDPOINT = '/api/brandsList';
const SEARCH_PRODUCT_ENDPOINT = '/api/searchProduct';

async function parseApiResponse(response: APIResponse): Promise<any> {
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('Products API', () => {

  test('should return products list', async ({ request }) => {
    const body = await parseApiResponse(await request.get(PRODUCTS_ENDPOINT));
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);
    for (const product of body.products) {
      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('price');
      expect(product).toHaveProperty('brand');
      expect(product).toHaveProperty('category');
    }
  });

  test('should return method not supported for POST to products list', async ({ request }) => {
    const body = await parseApiResponse(await request.post(PRODUCTS_ENDPOINT));
    expect(body.responseCode).toBe(405);
    expect(body.message).toBe('This request method is not supported.');
  });

  test('should return brands list', async ({ request }) => {
    const body = await parseApiResponse(await request.get(BRANDS_ENDPOINT));
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.brands)).toBe(true);
    expect(body.brands.length).toBeGreaterThan(0);
    for (const brand of body.brands) {
      expect(brand).toHaveProperty('id');
      expect(brand).toHaveProperty('brand');
    }
  });

  test('should return method not supported for PUT to brands list', async ({ request }) => {
    const body = await parseApiResponse(await request.put(BRANDS_ENDPOINT));
    expect(body.responseCode).toBe(405);
    expect(body.message).toBe('This request method is not supported.');
  });

  /* ⚠️  BROKEN — failed and could not be auto-fixed.
   * Root cause: Failed on first run — run `npm run fix` to investigate
   * Fix manually or run: npm run fix */
  test('should return products matching search term', async ({ request }) => {
    const body = await parseApiResponse(await request.post(SEARCH_PRODUCT_ENDPOINT, { form: { search_product: 'top' } }));
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
    for (const product of body.products) {
      // Accept any non-empty result — site may return products matching name or category
      const name = String(product.name ?? '').toLowerCase();
      const category = String(product.category ?? '').toLowerCase();
      expect(name.includes('top') || category.includes('top')).toBe(true);
    }
  });

  test('should return bad request for missing search_product parameter', async ({ request }) => {
    const body = await parseApiResponse(await request.post(SEARCH_PRODUCT_ENDPOINT));
    expect(body.responseCode).toBe(400);
    expect(body.message).toBe('Bad request, search_product parameter is missing in POST request.');
  });

  test('should return no matching products for non-existent search term', async ({ request }) => {
    const body = await parseApiResponse(await request.post(SEARCH_PRODUCT_ENDPOINT, { form: { search_product: 'zzznomatchproductxyz999' } }));
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.products.length).toBe(0);
  });

});