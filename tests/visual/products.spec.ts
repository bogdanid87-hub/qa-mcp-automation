import { test, expect } from '../../fixtures';

/**
 * Visual regression tests — products page static elements.
 *
 * These tests capture LAYOUT STRUCTURE of elements whose content
 * does not change with catalogue data. They will pass regardless
 * of which products are in the catalogue, their prices, or their images.
 *
 * For visual tests on data-driven areas (product grid, search results),
 * use page.route() to mock the API response — see the skeleton's
 * tests/visual/mocked-content.spec.ts.example for the pattern.
 */

test.describe('Products Page — Static Layout', () => {
  // [Visual Products Page — Static Layout #1]
  test('should match the navigation bar layout', async ({ page }) => {
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.locator('#header .navbar-nav').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // Nav links are fixed — this catches font, spacing, or order changes.
    await expect(page.locator('#header')).toHaveScreenshot('products-header-nav.png');
  });

  // [Visual Products Page — Static Layout #2]
  test('should match the left sidebar structure', async ({ page }) => {
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.locator('.left-sidebar').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // Category and brand taxonomy is fixed — sidebar structure doesn't
    // change with catalogue updates.
    await expect(page.locator('.left-sidebar')).toHaveScreenshot('products-sidebar.png');
  });

  // [Visual Products Page — Static Layout #3]
  test('should match the search bar layout', async ({ page }) => {
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.locator('#search_product').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // The search form (input + button) is structural — catches layout regressions
    // independently of what the search results contain.
    await expect(
      page.locator('#search_product').locator('..').locator('..'),
    ).toHaveScreenshot('products-search-bar.png');
  });
});
