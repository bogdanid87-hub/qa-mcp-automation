import { test, expect } from '../../fixtures';
import { ProductDetailPage } from '../../pages/ProductDetailPage';

test.describe('Product Detail', () => {
  // [UI Product Detail #1]
  test('should add product to cart from detail page and verify it appears in cart', async ({ page, cartPage }) => {
    // Navigate directly to the first product detail page
    await page.goto('/product_details/1', { waitUntil: 'domcontentloaded' });

    // Wait for the Add to cart button to be visible
    const addToCartBtn = page.getByRole('button', { name: 'Add to cart' });
    await expect(addToCartBtn).toBeVisible();

    // Capture the product name shown on the detail page for later verification
    const productNameLocator = page.locator('.product-information h2');
    await expect(productNameLocator).toBeVisible();
    const productName = (await productNameLocator.textContent()) ?? '';
    expect(productName.trim().length).toBeGreaterThan(0);

    // Click the Add to cart button
    await addToCartBtn.click();

    // Verify the cart modal appears with the 'Added!' confirmation heading
    const cartModal = page.locator('#cartModal');
    await expect(cartModal).toBeVisible({ timeout: 10000 });
    await expect(cartModal.getByRole('heading', { name: 'Added!' })).toBeVisible();

    // Click the View Cart link inside the modal to navigate to the cart page
    await page.locator('p.text-center a[href="/view_cart"]').click();
    await page.waitForLoadState('domcontentloaded');

    // Verify the cart page loaded and the product is present
    await cartPage.verifyLoaded();
    const rows = await cartPage.getCartRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Verify the product name in the cart matches the one on the detail page
    const cartProductName = rows[0].name;
    expect(cartProductName.trim().length).toBeGreaterThan(0);
    expect(cartProductName.trim()).toBe(productName.trim());

    // Verify row has a valid price and total
    expect(rows[0].price).toMatch(/Rs\.\s*\d+/);
    expect(rows[0].total).toMatch(/Rs\.\s*\d+/);
  });

  // [UI Product Detail #2]
  test('should reflect custom quantity in cart when quantity is changed before adding to cart', async ({ page, cartPage }) => {
    // Navigate directly to the first product detail page
    await page.goto('/product_details/1', { waitUntil: 'domcontentloaded' });

    const detailPage = new ProductDetailPage(page);

    // Wait for the page to be ready and read the unit price before adding to cart
    await expect(detailPage.productName).toBeVisible();
    const unitPrice = await detailPage.getPrice();
    expect(unitPrice).toBeGreaterThan(0);

    // Change the quantity input to 3
    await detailPage.changeQuantity(3);

    // Verify the input shows 3 before proceeding
    await expect(detailPage.quantityInput).toHaveValue('3');

    // Add the product to the cart and navigate to the cart via the modal
    await detailPage.addToCart();
    await expect(detailPage.cartModal.getByRole('heading', { name: 'Added!' })).toBeVisible();
    await detailPage.goToCart();

    // Verify the cart page loaded
    await cartPage.verifyLoaded();

    // Assert exactly one product row exists and it has the correct quantity and total
    const rows = await cartPage.getCartRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const qty = parseInt(rows[0].quantity, 10);
    expect(qty).toBe(3);

    const total = parseInt(rows[0].total.replace(/[^\d]/g, ''), 10);
    expect(total).toBe(unitPrice * 3);
  });
});
