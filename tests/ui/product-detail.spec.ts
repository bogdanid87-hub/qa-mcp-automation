import { test, expect } from '../../fixtures';
import { ProductDetailsPage } from '../../pages/ProductDetailsPage';
import { ViewCartPage } from '../../pages/ViewCartPage';
import { REVIEW } from '../../test-data/constants';

test.describe('Product Detail', () => {
  // [UI Product Detail #1]
  test('should add product to cart and verify it appears in cart @smoke @regression @critical', async ({ page }) => {
    const detailPage = new ProductDetailsPage(page);
    const cartPage = new ViewCartPage(page);

    // Navigate directly to a known product detail page
    await page.goto('/product_details/1', { waitUntil: 'domcontentloaded' });

    // Capture the product name from the page before adding to cart
    const productNameLocator = page.locator('.product-information h2');
    await productNameLocator.waitFor({ state: 'visible' });
    const productName = (await productNameLocator.textContent() ?? '').trim();
    expect(productName.length, 'product name should be non-empty').toBeGreaterThan(0);

    // Click Add to Cart via the form button and wait for the confirmation modal
    const addToCartBtn = page.locator('.product-information .btn.btn-default.cart');
    await addToCartBtn.click();
    const cartModal = page.locator('#cartModal');
    await cartModal.waitFor({ state: 'visible' });
    await expect(cartModal, 'cart confirmation modal should be visible after adding product').toBeVisible();

    // Click View Cart inside the modal to navigate to the cart page
    const viewCartLink = page.locator('#cartModal p.text-center a[href="/view_cart"]');
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      viewCartLink.click(),
    ]);

    // Verify the cart page loaded and contains the product
    await page.waitForURL(/\/view_cart/, { timeout: 10000 });
    const cartRows = page.locator('#cart_info_table tbody tr');
    await expect(cartRows.first(), 'cart table should have at least one row').toBeVisible();

    // Assert the product name in the cart matches the one from the detail page
    const cartProductName = page.locator('#cart_info_table tbody tr td.cart_description h4 a');
    const cartNameText = (await cartProductName.first().textContent() ?? '').trim();
    expect(cartNameText, 'product name in cart should match product name from detail page').toBe(productName);
  });

  // [UI Product Detail #2]
  test('should submit a product review and show the thank you message @regression', async ({ page }) => {
    const detailPage = new ProductDetailsPage(page);

    // Navigate directly to a known product detail page
    await page.goto('/product_details/1', { waitUntil: 'domcontentloaded' });
    await detailPage.verifyLoaded();

    // Scroll to the review form so it is in view
    await detailPage.nameInput.scrollIntoViewIfNeeded();

    // Fill in the review form fields using REVIEW constants
    await detailPage.nameInput.fill(REVIEW.name);
    await detailPage.emailInput.fill(REVIEW.email);
    await detailPage.reviewTextarea.fill(REVIEW.text);

    // Submit the review form
    await detailPage.submitReviewButton.click();

    // Verify the success message appears with the expected text
    await detailPage.successReviewMessage.waitFor({ state: 'visible', timeout: 10000 });
    await expect(
      detailPage.successReviewMessage,
      'success message should appear after submitting review'
    ).toBeVisible();
    await expect(
      detailPage.successReviewMessage,
      'success message should contain thank you text'
    ).toContainText('Thank you for your review.');
  });

  // [UI Product Detail #3]
  test('should show quantity 3 and correct total in cart when quantity is changed before adding to cart @regression @critical', async ({ page }) => {
    const detailPage = new ProductDetailsPage(page);
    const cartPage = new ViewCartPage(page);

    // Navigate directly to the product detail page
    await page.goto('/product_details/1', { waitUntil: 'domcontentloaded' });
    await detailPage.verifyLoaded();

    // Capture the unit price displayed on the product detail page
    const priceText = await detailPage.getPrice();
    expect(priceText.length, 'product price should be non-empty').toBeGreaterThan(0);
    if (!priceText.match(/\d+/)) throw new Error(`Unexpected price format: "${priceText}"`);
    const unitPriceNumber = parseInt(priceText.replace(/[^\d]/g, ''), 10);

    // Change the quantity input to 3 before adding to cart
    await detailPage.changeQuantity(3);

    // Add to cart and wait for the confirmation modal
    await detailPage.addToCart();
    await expect(detailPage.cartModal, 'cart modal should appear after adding product').toBeVisible();

    // Navigate to the cart via the modal View Cart link
    await detailPage.viewCart();
    await cartPage.verifyLoaded();

    // Wait for the cart table and at least one row to be present
    await cartPage.cartTable.waitFor({ state: 'visible' });
    const rowCount = await cartPage.cartRows.count();
    expect(rowCount, 'cart should contain exactly 1 row').toBe(1);

    // Verify the row shows quantity 3
    const rowQty = await cartPage.getRowQuantity(0);
    expect(rowQty, 'cart row quantity should be 3 after setting quantity to 3 on the detail page').toBe(3);

    // Verify the row total equals unit price × 3
    const rowTotal = await cartPage.getRowTotal(0);
    if (!rowTotal.match(/\d+/)) throw new Error(`Unexpected row total format: "${rowTotal}"`);
    const rowTotalNumber = parseInt(rowTotal.replace(/[^\d]/g, ''), 10);
    expect(
      rowTotalNumber,
      'cart row total should equal unit price × 3 when quantity is 3'
    ).toBe(unitPriceNumber * 3);
  });
});
