import { test, expect } from '../../fixtures';

/**
 * Visual regression test — cart page table structure.
 *
 * Two products are added to the cart so the table has populated rows.
 * All dynamic content (product names, prices, totals, images) is masked,
 * leaving only the structural skeleton: column widths, row heights,
 * button placement, quantity display, and delete icon position.
 */

test.describe('Cart Page — Table Structure', () => {
  // [Visual Cart Page — Table Structure #1]
  test('should match the cart table structure with content masked', async ({ page }) => {
    // Add the first product to the cart via the products page
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.locator('.features_items .product-image-wrapper').first().waitFor({ state: 'visible' });

    const firstCard = page.locator('.features_items .product-image-wrapper').nth(0);
    await firstCard.hover();
    await firstCard.locator('.product-overlay .add-to-cart, .productinfo .add-to-cart').first().click();
    // Wait for cart modal to appear, then continue shopping
    await page.locator('#cartModal').waitFor({ state: 'visible' });
    await page.locator('button[data-dismiss="modal"]').filter({ hasText: 'Continue Shopping' }).click();
    await page.locator('#cartModal').waitFor({ state: 'hidden' });

    // Add the second product to the cart
    const secondCard = page.locator('.features_items .product-image-wrapper').nth(1);
    await secondCard.hover();
    await secondCard.locator('.product-overlay .add-to-cart, .productinfo .add-to-cart').first().click();
    await page.locator('#cartModal').waitFor({ state: 'visible' });
    // Navigate to cart via the modal View Cart link
    await page.locator('p.text-center a[href="/view_cart"]').click();
    await page.waitForLoadState('domcontentloaded');

    // Wait for the cart table and at least one row to be present
    await page.locator('#cart_info_table').waitFor({ state: 'visible' });
    await page.locator('#cart_info_table tbody tr').first().waitFor({ state: 'visible' });

    // Wait for all cart table images to finish loading before capturing.
    // Masking covers image elements but the mask bounding box is wrong when an
    // image hasn't loaded yet (zero or incorrect height shifts surrounding layout).
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#cart_info_table img')].every(
        img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalHeight > 0,
      )
    );

    // Allow CSS transitions to settle before capturing
    await page.waitForTimeout(500);

    // Capture the cart table structure with all dynamic content masked.
    // Masks applied:
    //   - Product images (change with catalogue updates)
    //   - Product name links (change with catalogue updates)
    //   - Unit price cells (change with promotions)
    //   - Row total cells (derived from price × quantity — also dynamic)
    await expect(page.locator('#cart_info_table')).toHaveScreenshot('cart-table-structure.png', {
      mask: [
        page.locator('#cart_info_table .cart_description h4 a'),
        page.locator('#cart_info_table .cart_description p'),
        page.locator('#cart_info_table .cart_price p'),
        page.locator('#cart_info_table .cart_total p'),
        page.locator('#cart_info_table .cart_description img'),
      ],
    });
  });
});
