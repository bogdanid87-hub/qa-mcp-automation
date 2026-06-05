import { test, expect } from '../../fixtures';
import { HomePage } from '../../pages/HomePage';
import { ViewCartPage } from '../../pages/ViewCartPage';
import { TEST_USER } from '../../test-data/constants';

test.describe('Newsletter Subscription', () => {
  // [UI Newsletter Subscription #1]
  test('should subscribe successfully from home page footer @smoke @regression', async ({ page }) => {
    const homePage = new HomePage(page);

    // Navigate to the home page
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Scroll to the footer subscription form
    await homePage.scrollToFooter();

    // Enter a valid email address and click Subscribe
    const email = TEST_USER.email();
    await homePage.subscribeToNewsletter(email);

    // Verify the success message confirms the subscription
    await expect(homePage.subscribeSuccessMessage, 'success alert should be visible after subscribing').toBeVisible();
  });

  // [UI Newsletter Subscription #2]
  test('should subscribe successfully from cart page footer without leaving the cart @regression', async ({ page }) => {
    const cartPage = new ViewCartPage(page);

    // Navigate directly to the cart page
    await cartPage.goto();
    await cartPage.verifyLoaded();

    // Scroll down to the footer subscription form
    await cartPage.scrollToFooter();

    // Enter a valid email address and submit the subscription form
    const email = TEST_USER.email();
    await cartPage.subscribeToNewsletter(email);

    // Verify the success message appears confirming the subscription
    await expect(
      cartPage.subscribeSuccessMessage,
      'success alert should be visible after subscribing from the cart page footer',
    ).toBeVisible();

    // Verify the user has not been navigated away from the cart page
    await expect(page, 'URL should still be /view_cart after subscribing').toHaveURL(/\/view_cart/);
  });

  // [UI Newsletter Subscription #3]
  test('should reject invalid email format in the subscription form @regression', async ({ page }) => {
    const homePage = new HomePage(page);

    // Navigate to the home page
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Scroll to the footer subscription form
    await homePage.scrollToFooter();

    // Fill in an invalid email format — the browser's native <input type="email"> validation
    // should prevent form submission before the request reaches the server
    await homePage.subscribeEmailInput.fill('notanemail');

    // Attempt to submit the subscription form
    await homePage.subscribeBtn.click();

    // Verify the browser's native email validation fires — the input should be marked invalid
    const isInvalid = await homePage.subscribeEmailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid,
    );
    expect(isInvalid, 'browser should mark the email input as invalid for a malformed address').toBe(true);

    // Verify no success message appears (form was not submitted)
    const successAppeared = await homePage.subscribeSuccessMessage
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    expect(successAppeared, 'success message should NOT appear after submitting an invalid email').toBe(false);
  });

  // [UI Newsletter Subscription #4]
  test('should prevent submission when email field is empty @regression', async ({ page }) => {
    const homePage = new HomePage(page);

    // Navigate to the home page
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Scroll to the footer subscription form
    await homePage.scrollToFooter();

    // Ensure the email input is empty (no text entered)
    await homePage.subscribeEmailInput.clear();

    // Attempt to submit the subscription form without entering any email
    await homePage.subscribeBtn.click();

    // Verify the browser's native required-field validation fires —
    // an empty <input type="email" required> should be marked invalid
    const isInvalid = await homePage.subscribeEmailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid,
    );
    expect(isInvalid, 'browser should mark the empty email input as invalid').toBe(true);

    // Verify no success message appears — the form submission was blocked by native validation
    const successAppeared = await homePage.subscribeSuccessMessage
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    expect(successAppeared, 'success message should NOT appear when the email field is empty').toBe(false);
  });
});
