import { test, expect } from '../../fixtures';

test.describe('Products Page Visual', () => {
  // [Visual Products Page Visual #3]
  test('should match the products page layout baseline', async ({ page }) => {
    // Navigate to the products page and wait for it to fully settle
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Wait for the product grid and sidebar to be visible before capturing
    await page.locator('.features_items').waitFor({ state: 'visible' });
    await page.locator('.left-sidebar').waitFor({ state: 'visible' });

    // Allow CSS transitions to complete
    await page.waitForTimeout(500);

    // Capture the full page layout as a baseline — mask the sales banner image
    // which may change independently of layout, and the subscription alert
    await expect(page).toHaveScreenshot('products-page-full.png', {
      fullPage: true,
      mask: [
        page.locator('img[src="/static/images/shop/sale.jpg"]'),
        page.locator('.alert-success.alert'),
      ],
    });
  });

  // [Visual Products Page Visual #1]
  test('should match the products left sidebar layout baseline', async ({ page }) => {
    // Navigate to the products page
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Wait for the sidebar to be visible
    await page.locator('.left-sidebar').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // Capture only the left sidebar (category and brand filters)
    await expect(page.locator('.left-sidebar')).toHaveScreenshot('products-left-sidebar.png');
  });

  // [Visual Products Page Visual #2]
  test('should match the products grid layout baseline', async ({ page }) => {
    // Navigate to the products page
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Wait for the product grid to be populated
    await page.locator('.features_items').waitFor({ state: 'visible' });
    await page.locator('.features_items .product-image-wrapper').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // Capture the featured product cards grid
    await expect(page.locator('.features_items')).toHaveScreenshot('products-grid.png');
  });
});
