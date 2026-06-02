import { test, expect } from '../../fixtures';
import type { APIResponse } from '@playwright/test';

const BRANDS_ENDPOINT = '/api/brandsList';

async function parseApiResponse(response: APIResponse): Promise<any> {
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('Brands API', () => {
  // [API Brands API #1]
  test('should return brands list with brand fields', async ({ request }) => {
    const body = await parseApiResponse(await request.get(BRANDS_ENDPOINT));
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.brands)).toBe(true);

    for (const brand of body.brands) {
      expect(typeof brand.brand).toBe('string');
    }
  });
});
