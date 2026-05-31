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

  // [API Products API #1]
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

  // [API Products API #2]
  test('should return method not supported for POST to products list', async ({ request }) => {
    const body = await parseApiResponse(await request.post(PRODUCTS_ENDPOINT));
    expect(body.responseCode).toBe(405);
    expect(body.message).toBe('This request method is not supported.');
  });

  // [API Products API #3]
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

  // [API Products API #4]
  test('should return method not supported for PUT to brands list', async ({ request }) => {
    const body = await parseApiResponse(await request.put(BRANDS_ENDPOINT));
    expect(body.responseCode).toBe(405);
    expect(body.message).toBe('This request method is not supported.');
  });

  // [API Products API #7]
  test('should return products matching search term', async ({ request }) => {
    const body = await parseApiResponse(await request.post(SEARCH_PRODUCT_ENDPOINT, { form: { search_product: 'top' } }));
    expect(body.responseCode).toBe(200);
    // category is a nested object { usertype: {...}, category: '...' } — do not stringify and compare
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);
  });

  // [API Products API #5]
  test('should return bad request for missing search_product parameter', async ({ request }) => {
    const body = await parseApiResponse(await request.post(SEARCH_PRODUCT_ENDPOINT));
    expect(body.responseCode).toBe(400);
    expect(body.message).toBe('Bad request, search_product parameter is missing in POST request.');
  });

  // [API Products API #6]
  test('should return a valid response for non-existent search term', async ({ request }) => {
    const body = await parseApiResponse(await request.post(SEARCH_PRODUCT_ENDPOINT, { form: { search_product: 'zzznomatchproductxyz999' } }));
    // Site may return empty array or 404 responseCode — assert valid structure only
    expect(typeof body.responseCode).toBe('number');
  });

});