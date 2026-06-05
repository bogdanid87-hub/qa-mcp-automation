import { test, expect } from '../../fixtures';
import { ProductsPage } from '../../pages/ProductsPage';
import { ViewCartPage } from '../../pages/ViewCartPage';

test.describe('Cart', () => {
  // [UI Cart #1]
  test(
    'should add two products and verify names, unit prices, quantities, and row totals @smoke @regression @critical',
    async ({ page }) => {
      const productsPage = new ProductsPage(page);
      const cartPage     = new ViewCartPage(page);

      // Navigate to /products and wait for at least two product cards to be visible
      await productsPage.goto();
      await productsPage.productCards.first().waitFor({ state: 'visible' });

      // Capture the name and price of the first product before adding it to the cart
      const firstName  = await productsPage.getCardProductName(0);
      const firstPrice = await productsPage.getCardPrice(0);
      expect(firstName.length,  'first product name should not be empty').toBeGreaterThan(0);
      expect(firstPrice.length, 'first product price should not be empty').toBeGreaterThan(0);

      // Add the first product to the cart and dismiss the modal to stay on the products page
      await productsPage.hoverAndAddToCart(0);
      await productsPage.continueShopping();

      // Capture the name and price of the second product before adding it to the cart
      const secondName  = await productsPage.getCardProductName(1);
      const secondPrice = await productsPage.getCardPrice(1);
      expect(secondName.length,  'second product name should not be empty').toBeGreaterThan(0);
      expect(secondPrice.length, 'second product price should not be empty').toBeGreaterThan(0);

      // Add the second product to the cart and navigate to the cart via the modal link
      await productsPage.hoverAndAddToCart(1);
      await productsPage.clickViewCart();
      await cartPage.verifyLoaded();

      // Wait for the cart table and both rows to be present
      await cartPage.cartTable.waitFor({ state: 'visible' });
      const rowCount = await cartPage.cartRows.count();
      expect(rowCount, 'cart should contain exactly 2 rows').toBe(2);

      // Verify the first row: name, unit price, quantity=1, and total equals unit price
      const row0Name     = await cartPage.getRowProductName(0);
      const row0Price    = await cartPage.getRowUnitPrice(0);
      const row0Qty      = await cartPage.getRowQuantity(0);
      const row0Total    = await cartPage.getRowTotal(0);

      expect(row0Name,  'first cart row name should match product name from listing').toBe(firstName);
      expect(row0Price, 'first cart row unit price should match product price from listing').toBe(firstPrice);
      expect(row0Qty,   'first cart row quantity should be 1').toBe(1);
      expect(row0Total, 'first cart row total should equal unit price when quantity is 1').toBe(row0Price);

      // Verify the second row: name, unit price, quantity=1, and total equals unit price
      const row1Name     = await cartPage.getRowProductName(1);
      const row1Price    = await cartPage.getRowUnitPrice(1);
      const row1Qty      = await cartPage.getRowQuantity(1);
      const row1Total    = await cartPage.getRowTotal(1);

      expect(row1Name,  'second cart row name should match product name from listing').toBe(secondName);
      expect(row1Price, 'second cart row unit price should match product price from listing').toBe(secondPrice);
      expect(row1Qty,   'second cart row quantity should be 1').toBe(1);
      expect(row1Total, 'second cart row total should equal unit price when quantity is 1').toBe(row1Price);
    },
  );

  // [UI Cart #2]
  test(
    'should show empty cart when navigating directly to cart without adding products @regression',
    async ({ page }) => {
      const cartPage = new ViewCartPage(page);

      // Navigate directly to the cart page without adding any products
      await cartPage.goto();
      await cartPage.verifyLoaded();

      // Verify no product rows are visible in the cart table
      const rowCount = await cartPage.cartRows.count();
      expect(rowCount, 'cart should contain no product rows when empty').toBe(0);

      // Verify the empty cart message is shown to the user
      await expect(cartPage.emptyCartMessage, 'empty cart message should be visible').toBeVisible();
    },
  );

  // [UI Cart #3]
  test(
    'should show quantity 2 in a single row when the same product is added to the cart twice @regression @critical',
    async ({ page }) => {
      const productsPage = new ProductsPage(page);
      const cartPage     = new ViewCartPage(page);

      // Navigate to /products and wait for product cards to be visible
      await productsPage.goto();
      await productsPage.productCards.first().waitFor({ state: 'visible' });

      // Capture the name and price of the first product before adding it
      const productName  = await productsPage.getCardProductName(0);
      const productPrice = await productsPage.getCardPrice(0);
      expect(productName.length,  'product name should not be empty').toBeGreaterThan(0);
      expect(productPrice.length, 'product price should not be empty').toBeGreaterThan(0);

      // Add the same product to the cart a first time and dismiss the modal
      await productsPage.hoverAndAddToCart(0);
      await productsPage.continueShopping();

      // Add the same product to the cart a second time and navigate to the cart
      await productsPage.hoverAndAddToCart(0);
      await productsPage.clickViewCart();
      await cartPage.verifyLoaded();

      // Wait for the cart table to be visible
      await cartPage.cartTable.waitFor({ state: 'visible' });

      // The cart should contain exactly one row for the duplicated product
      const rowCount = await cartPage.cartRows.count();
      expect(rowCount, 'cart should show exactly one row when the same product is added twice').toBe(1);

      // Verify the single row has quantity 2
      const rowQty = await cartPage.getRowQuantity(0);
      expect(rowQty, 'quantity should be 2 after adding the same product twice').toBe(2);

      // Verify the product name in the row matches what was shown on the products page
      const rowName = await cartPage.getRowProductName(0);
      expect(rowName, 'cart row name should match the product added from the listing').toBe(productName);

      // Verify the unit price in the row matches the listing price
      const rowUnitPrice = await cartPage.getRowUnitPrice(0);
      expect(rowUnitPrice, 'cart row unit price should match the listing price').toBe(productPrice);

      // Verify the row total equals double the unit price (price × 2)
      const rowTotal = await cartPage.getRowTotal(0);
      const unitPriceNumber = parseInt(rowUnitPrice.replace(/[^\d]/g, ''), 10);
      const rowTotalNumber  = parseInt(rowTotal.replace(/[^\d]/g, ''), 10);
      if (!rowUnitPrice.match(/\d+/)) throw new Error(`Unexpected unit price format: "${rowUnitPrice}"`);
      if (!rowTotal.match(/\d+/))     throw new Error(`Unexpected row total format: "${rowTotal}"`);
      expect(rowTotalNumber, 'row total should equal unit price × 2 when quantity is 2').toBe(unitPriceNumber * 2);
    },
  );

  // [UI Cart #4]
  test(
    'should show checkout modal with register/login option when guest clicks Proceed To Checkout @smoke @regression @critical',
    async ({ page }) => {
      const productsPage = new ProductsPage(page);
      const cartPage     = new ViewCartPage(page);

      // Navigate to /products and wait for product cards to load
      await productsPage.goto();
      await productsPage.productCards.first().waitFor({ state: 'visible' });

      // Add one product to the cart and navigate to the cart page via the modal link
      await productsPage.hoverAndAddToCart(0);
      await productsPage.clickViewCart();
      await cartPage.verifyLoaded();

      // Confirm the cart has at least one product row before proceeding
      await cartPage.cartTable.waitFor({ state: 'visible' });
      const rowCount = await cartPage.cartRows.count();
      expect(rowCount, 'cart should contain at least one product row before checkout').toBeGreaterThan(0);

      // Click Proceed To Checkout and wait for the modal to appear
      await cartPage.clickProceedToCheckout();

      // Verify the checkout modal is visible
      await expect(cartPage.checkoutModal, 'checkout modal should appear when guest clicks Proceed To Checkout').toBeVisible();

      // Verify the modal contains a link directing the guest to register or log in
      await expect(
        cartPage.checkoutModalRegisterLoginLink,
        'checkout modal should contain a Register / Login link so the guest can authenticate',
      ).toBeVisible();
    },
  );

  // [UI Cart #4]
  test(
    'should remove a product from the cart and show an empty cart @regression @critical',
    async ({ page }) => {
      const productsPage = new ProductsPage(page);
      const cartPage     = new ViewCartPage(page);

      // Navigate to /products and wait for product cards to be visible
      await productsPage.goto();
      await productsPage.productCards.first().waitFor({ state: 'visible' });

      // Add the first product to the cart and navigate to the cart via the modal link
      await productsPage.hoverAndAddToCart(0);
      await productsPage.clickViewCart();
      await cartPage.verifyLoaded();

      // Confirm the cart has exactly one product row before deleting
      await cartPage.cartTable.waitFor({ state: 'visible' });
      const rowCountBefore = await cartPage.cartRows.count();
      expect(rowCountBefore, 'cart should contain exactly one product row before deletion').toBe(1);

      // Click the delete icon for the first (only) row and wait for the row to detach
      await cartPage.deleteRow(0);

      // Verify the cart now has no product rows
      const rowCountAfter = await cartPage.cartRows.count();
      expect(rowCountAfter, 'cart should contain no product rows after deletion').toBe(0);

      // Verify the empty cart message is displayed to the user
      await expect(cartPage.emptyCartMessage, 'empty cart message should be visible after removing the only product').toBeVisible();
    },
  );
});
