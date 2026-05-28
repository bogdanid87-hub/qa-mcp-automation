import { test, expect } from '../../fixtures';

const SEARCH_TERM = 'jeans';

test.describe('Product Search', () => {
  test('should search for a product and verify results match the API', async ({ homePage, productsPage, page, request }) => {
    // Navigate home and verify (carousel check included in verifyLoaded)
    await homePage.goto();
    await homePage.verifyLoaded();

    // Click Products button and verify the All Products page (sales image check included)
    await homePage.clickProducts();
    await productsPage.verifyLoaded();

    // Search for jeans
    await productsPage.search(SEARCH_TERM);

    // Verify SEARCHED PRODUCTS heading is visible
    await expect(productsPage.searchedProductsHeading).toBeVisible();

    // Verify search term is present in the URL
    await expect(page).toHaveURL(new RegExp(`search=${SEARCH_TERM}`, 'i'));

    // Collect UI product names and verify they are all visible
    const uiProductNames = await productsPage.getProductNames();
    expect(uiProductNames.length).toBeGreaterThan(0);
    for (const name of uiProductNames) {
      await expect(productsPage.productNames.filter({ hasText: name })).toBeVisible();
    }

    // Call the API and verify it returns the same products as the UI
    const response = await request.post('https://automationexercise.com/api/searchProduct', {
      form: { search_product: SEARCH_TERM },
    });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.responseCode).toBe(200);

    const apiProductNames: string[] = data.products.map((p: { name: string }) => p.name);
    expect(uiProductNames.length).toBe(apiProductNames.length);
    for (const apiName of apiProductNames) {
      expect(uiProductNames).toContain(apiName);
    }
  });
});
