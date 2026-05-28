import { test, expect } from '../fixtures';
import { randomName, randomEmail, randomPassword } from '../utils/randomData';

test.describe('Place Order: Register while Checkout', () => {
  test('should register during checkout, place order, and delete account', async ({
    page,
    homePage,
    productsPage,
    cartPage,
    checkoutPage,
  }) => {

    // Step 2-3: Navigate to home page and verify it loaded successfully
    await homePage.goto();
    await homePage.verifyLoaded();

    // Step 4: Add a product to the cart from the products page
    await homePage.clickProducts();
    await productsPage.verifyLoaded();
    await productsPage.hoverAndAddToCart(0);
    await productsPage.clickViewCart();

    // Step 5-6: Verify cart page is displayed
    await cartPage.verifyLoaded();
    await expect(page).toHaveURL(/\/view_cart/);

    // Step 7: Click 'Proceed To Checkout' on the cart page
    await cartPage.proceedToCheckout();

    // Step 8: Click 'Register / Login' button in the checkout modal
    await checkoutPage.clickRegisterLogin();

    // Step 9: Fill in signup details and create account
    const username = randomName();
    const email = randomEmail();
    const password = randomPassword();
    await checkoutPage.signup(username, email, password);

    // Step 10: Verify 'ACCOUNT CREATED!' message and click Continue
    await checkoutPage.verifyAccountCreated();
    await checkoutPage.clickContinueAfterAccountCreation();

    // Step 11: Verify 'Logged in as username' appears in the navbar
    await checkoutPage.verifyLoggedIn(username);

    // Step 12: Navigate to the cart page
    await page.goto('/view_cart');
    await cartPage.verifyLoaded();

    // Step 13: Click 'Proceed To Checkout'
    await cartPage.proceedToCheckout();

    // Step 14: Verify Address Details and Review Your Order sections are visible
    await expect(page.locator('[data-qa="checkout-info"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();

    // Step 15: Enter comment and place order
    await checkoutPage.fillComment('Automated test order — please ignore');
    await checkoutPage.clickPlaceOrder();

    // Step 16: Enter payment details
    await checkoutPage.enterPaymentDetails(
      username,
      '4111111111111111',
      '123',
      '12',
      '2028'
    );

    // Step 17: Click 'Pay and Confirm Order'
    await checkoutPage.clickPayAndConfirmOrder();

    // Step 18: Verify success message 'Your order has been placed successfully!'
    await checkoutPage.verifyOrderPlaced();

    // Step 19: Click 'Delete Account'
    await page.getByRole('link', { name: 'Delete Account' }).click();
    await page.waitForLoadState('load');

    // Step 20: Verify 'ACCOUNT DELETED!' and click Continue
    await expect(page.locator('[data-qa="account-deleted"]')).toBeVisible();
    await page.locator('[data-qa="continue-button"]').click();
    await page.waitForLoadState('load');
  });
});
