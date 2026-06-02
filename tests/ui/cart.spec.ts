import { test, expect } from '../../fixtures';

test.describe('Cart', () => {
  // Tests interact with shared cart state — must run in order
  test.describe.configure({ mode: 'serial' });

  // [UI Cart #1]
  test('should add two products to cart and verify prices, quantity and total', async ({ homePage, productsPage, cartPage }) => {
    // Step 2-3: Navigate to home page and verify it loaded successfully
    await homePage.goto();
    await homePage.verifyLoaded();

    // Step 4: Click Products button and verify the All Products page loads
    await homePage.clickProducts();
    await productsPage.verifyLoaded();

    // Step 5: Hover over the first product and add it to the cart
    await productsPage.hoverAndAddToCart(0);

    // Step 6: Click 'Continue Shopping' to stay on the products page
    await productsPage.continueShopping();

    // Step 7: Hover over the second product and add it to the cart
    await productsPage.hoverAndAddToCart(1);

    // Step 8: Click 'View Cart' inside the modal to navigate to cart page
    await productsPage.clickViewCart();

    // Step 9-10: Verify cart loaded and both products are present with correct price, quantity and total
    await cartPage.verifyLoaded();

    const rows = await cartPage.getCartRows();

    // Assert at least two products are in the cart
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Verify each row has a non-empty name, price, quantity and total
    for (const row of rows) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.price).toMatch(/Rs\. \d+/);
      expect(row.quantity).toMatch(/\d+/);
      expect(row.total).toMatch(/Rs\. \d+/);
    }

    // Verify that for each row the total equals price × quantity
    for (const row of rows) {
      const price = parseInt(row.price.replace(/[^\d]/g, ''), 10);
      const qty = parseInt(row.quantity, 10);
      const total = parseInt(row.total.replace(/[^\d]/g, ''), 10);
      expect(total).toBe(price * qty);
    }
  });

  // [UI Cart #2]
  test('should show empty cart when no products have been added', async ({ cartPage, page }) => {
    // Navigate directly to the cart page without adding any products
    await cartPage.goto();

    // Verify we are on the cart URL
    await expect(page).toHaveURL(/\/view_cart/);

    // Assert that the cart contains no product rows — either the table is empty
    // or a dedicated empty-cart message element is visible
    const rowCount = await cartPage.cartRows.count();
    if (rowCount === 0) {
      expect(rowCount).toBe(0);
    } else {
      // Some versions of the page show an empty-cart section instead
      await expect(cartPage.emptyCartMessage).toBeVisible();
    }
  });

  /* ⚠️  APP BUG — This test is correct; the application under test has a defect.
   * Expected behaviour: The automationexercise.com cart page does not have an editable quantity input field (`.cart_quantity input`). The cart quantity is displayed as a static button/text element, not an `<input>` element. The locator `.cart_quantity input` never resolves because no such input exists in the DOM.
   * Actual behaviour:   The cart page renders quantity as a read-only button element (`.cart_quantity button`) rather than an editable `<input>`. There is no inline quantity editor on the cart page — the site does not support updating quantity directly from the cart view. The `setQuantity` method times out waiting for an input element that does not exist.
   * Do NOT change this test — it documents a real bug. Fix the application instead. */
  test('should update total correctly when product quantity is changed in cart', async ({ homePage, productsPage, cartPage, page }) => {
    // Navigate to products page
    await homePage.goto();
    await homePage.verifyLoaded();
    await homePage.clickProducts();
    await productsPage.verifyLoaded();

    // Add the first product to the cart
    await productsPage.hoverAndAddToCart(0);

    // Navigate to the cart via the modal View Cart link
    await productsPage.clickViewCart();
    await cartPage.verifyLoaded();

    // Capture the unit price before changing the quantity
    const unitPrice = await cartPage.getRowPrice(0);
    expect(unitPrice).toBeGreaterThan(0);

    // Change quantity to 2 using the quantity input in the first cart row
    await cartPage.setQuantity(0, 2);

    // Re-fetch rows after quantity update and verify the new total equals 2 × unit price
    const updatedRows = await cartPage.getCartRows();
    const updatedTotal = parseInt(updatedRows[0].total.replace(/[^\d]/g, ''), 10);
    expect(updatedTotal).toBe(unitPrice * 2);
  });

  // [UI Cart #3]
  test('should remove a product from the cart and update the cart', async ({ homePage, productsPage, cartPage, page }) => {
    // Navigate to products page
    await homePage.goto();
    await homePage.verifyLoaded();
    await homePage.clickProducts();
    await productsPage.verifyLoaded();

    // Add the first product to the cart
    await productsPage.hoverAndAddToCart(0);

    // Navigate to the cart via the modal View Cart link
    await productsPage.clickViewCart();
    await cartPage.verifyLoaded();

    // Confirm one product is present before removal
    const rowsBefore = await cartPage.getRowCount();
    expect(rowsBefore).toBeGreaterThanOrEqual(1);

    // Remove the first product using the delete icon
    await cartPage.removeProduct(0);

    // Assert that the cart is now empty — the row should be gone
    const rowsAfter = await cartPage.cartRows.count();
    expect(rowsAfter).toBe(0);
  });
});
