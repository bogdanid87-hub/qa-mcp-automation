import { test, expect } from '../../fixtures';
import { randomName, randomEmail, randomPassword } from '../../utils/randomData';

test.describe('Place Order', () => {
  // Credentials scoped here so afterEach can clean up even on mid-test failure
  let testEmail = '';
  let testPassword = '';

  test.afterEach(async ({ request }) => {
    if (testEmail) {
      // Safety net: delete the account via API in case the test failed before the UI deletion
      await request.delete('https://automationexercise.com/api/deleteAccount', {
        form: { email: testEmail, password: testPassword },
      }).catch(() => {}); // non-fatal — account may already be deleted by the test itself
      testEmail = '';
      testPassword = '';
    }
  });

  // [E2E Place Order #1]
  test('should register during checkout, place an order, and delete the account', async ({
    page,
    homePage,
    productsPage,
    cartPage,
    checkoutPage,
    loginPage,
    accountPage,
  }) => {
    test.setTimeout(5 * 60_000); // multi-step flow — 5 minutes

    // Step 2-3: Navigate to home page and verify it loaded successfully
    await homePage.goto();
    await homePage.verifyLoaded();

    // Step 4: Add products to the cart from the Products page
    await homePage.clickProducts();
    await productsPage.verifyLoaded();
    await productsPage.hoverAndAddToCart(0);
    await productsPage.continueShopping();

    // Step 5-6: Click Cart in the nav and verify the cart page is displayed
    await page.goto('/view_cart');
    await cartPage.verifyLoaded();

    // Step 7: Click Proceed To Checkout — expect the login/register modal or redirect
    await cartPage.proceedToCheckout();

    // Step 8: Click 'Register / Login' button from the checkout modal
    await cartPage.clickRegisterLogin();
    await page.waitForLoadState('load');

    // Step 9: Fill all details in Signup form and create account
    const name = randomName();
    testEmail = randomEmail();
    testPassword = randomPassword();
    const email = testEmail;
    const password = testPassword;
    await loginPage.signupWithNameAndEmail(name, email);
    await page.waitForLoadState('load');
    await accountPage.fillAccountDetails({
      password,
      firstName: name,
      lastName: 'Test',
      address: '123 Test Street',
      country: 'United States',
      state: 'California',
      city: 'Los Angeles',
      zipcode: '90001',
      mobileNumber: '5551234567',
    });
    await accountPage.createAccount();

    // Step 10: Verify 'ACCOUNT CREATED!' and click 'Continue' button
    await expect(accountPage.accountCreatedMessage).toBeVisible();
    await accountPage.clickContinue();

    // Step 11: Verify 'Logged in as username' at top
    await expect(homePage.loggedInAs).toContainText(name);

    // Step 12: Click 'Cart' button
    await page.goto('/view_cart', { waitUntil: 'domcontentloaded' });
    await cartPage.verifyLoaded();

    // Step 13: Click 'Proceed To Checkout' button
    await cartPage.proceedToCheckout();
    await page.waitForLoadState('load');

    // Step 14: Verify Address Details and Review Your Order sections are visible
    await checkoutPage.verifyLoaded();

    // Step 15: Enter description in comment text area and click 'Place Order'
    await checkoutPage.enterComment('Please handle with care.');
    await checkoutPage.placeOrder();

    // Step 16: Enter payment details
    await checkoutPage.fillPaymentDetails(
      name,
      '4111111111111111',
      '123',
      '12',
      '2027'
    );

    // Step 17-18: Click 'Pay and Confirm Order' and verify success message
    await checkoutPage.payAndConfirm();
    await expect(checkoutPage.orderPlacedMessage).toBeVisible();

    // Step 19-20: Click 'Delete Account' and verify 'ACCOUNT DELETED!'
    await checkoutPage.deleteAccount();
    await expect(checkoutPage.accountDeletedMessage).toBeVisible();
  });
});
