// fixtures/mocks/productSearch.ts
import { Page } from '@playwright/test';

export async function mockProductSearch(page: Page): Promise<void> {
  await page.route('**/api/products', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        responseCode: 200,
        products: [{
          id: 1,
          name: 'Blue Top',
          price: 500
        }]
      }),
    });
  });
}

export async function unmockProductSearch(page: Page): Promise<void> {
  await page.unroute('**/api/products');
}
