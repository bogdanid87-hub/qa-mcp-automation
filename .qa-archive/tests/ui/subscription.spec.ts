import { test, expect } from '../../fixtures';
import { randomEmail } from '../../utils/randomData';

test.describe('Subscription', () => {
  // [UI Subscription #1]
  test('should subscribe via the footer subscription form on the home page', async ({ homePage, page }) => {
    // Step 2-3: Navigate to home page and verify it loaded successfully
    await homePage.goto();
    await homePage.verifyLoaded();

    // Step 4: Scroll down to the footer section
    await homePage.scrollToFooter();

    // Step 5: Verify the SUBSCRIPTION heading is visible in the footer
    await expect(homePage.subscriptionHeading).toBeVisible();

    // Step 6: Enter a valid email address and click the subscribe button
    const email = randomEmail();
    await homePage.subscribeToNewsletter(email);

    // Step 7: Verify the success message is displayed
    await homePage.verifySubscriptionSuccess();
  });

  // [UI Subscription #2]
  test('should show an error when subscribing with an invalid email format', async ({ homePage, page }) => {
    // Navigate to home page and verify it loaded successfully
    await homePage.goto();
    await homePage.verifyLoaded();

    // Scroll down to the footer subscription form
    await homePage.scrollToFooter();

    // Verify the SUBSCRIPTION heading is visible in the footer
    await expect(homePage.subscriptionHeading).toBeVisible();

    // Enter a malformed email address and attempt to subscribe
    await homePage.subscribeToNewsletter('notanemail');

    // Assert that the success message is NOT shown, meaning subscription failed
    await expect(homePage.subscribeSuccessMessage).not.toBeVisible();

    // Assert that the browser's native validation prevents submission (input is invalid)
    const isInvalid = await page.locator('#susbscribe_email').evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    );
    expect(isInvalid).toBe(true);
  });

  // [UI Subscription #3]
  test('should subscribe via the footer subscription form on the Cart page', async ({ page }) => {
    // Navigate to the cart page
    await page.goto('/view_cart', { waitUntil: 'domcontentloaded' });

    // Scroll to the footer subscription section
    await page.locator('#footer').scrollIntoViewIfNeeded();
    await page.locator('#susbscribe_email').waitFor({ state: 'visible' });

    // Enter a valid email and click the subscribe button
    const email = randomEmail();
    await page.locator('#susbscribe_email').fill(email);
    await page.locator('#subscribe').click();

    // Verify the success message appears
    await expect(
      page.locator('#success-subscribe'),
      'Success message should be visible after subscribing',
    ).toBeVisible({ timeout: 5000 });
  });

  // [UI Subscription #4]
  test('subscribe with empty email on cart page shows native validation and no success message', async ({ page }) => {
    // Navigate directly to the cart page
    await page.goto('/view_cart', { waitUntil: 'domcontentloaded' });

    // Scroll to the footer subscription section
    await page.locator('#footer').scrollIntoViewIfNeeded();
    await page.locator('#susbscribe_email').waitFor({ state: 'visible' });

    // Leave the email input empty and click subscribe
    await page.locator('#susbscribe_email').fill('');
    await page.locator('#subscribe').click();

    // Assert the success message does NOT appear
    const appeared = await page
      .locator('.alert-success.alert')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    expect(appeared, 'Success message should not appear when email is empty').toBe(false);

    // Assert browser native validation fires on the empty email field
    const isInvalid = await page.locator('#susbscribe_email').evaluate(
      (el) => !(el as HTMLInputElement).validity.valid
    );
    expect(isInvalid, 'Email input should be marked invalid by native browser validation').toBe(true);
  });

  /* ⚠️  APP BUG — This test is correct; the application under test has a defect.
   * Expected behaviour: The test asserts that subscribing with the same email twice should not show a success message on the second attempt. However, the screenshot confirms that the application does show 'You have been successfully subscribed!' for the duplicate email — the site accepts duplicate subscriptions without any error or rejection.
   * Actual behaviour:   automationexercise.com accepts duplicate email subscriptions silently. When the same email is submitted a second time, the site responds with the same 'You have been successfully subscribed!' success message as the first submission, rather than rejecting or warning about the duplicate.
   * Do NOT change this test — it documents a real bug. Fix the application instead. */
  test('should reject duplicate email subscriptions', async ({ homePage }) => {
    test.fail(); // APP BUG: expected to fail — site accepts duplicates instead of rejecting
    // Navigate to home page
    await homePage.goto();
    await homePage.verifyLoaded();

    // Scroll to footer and verify the subscription section is present
    await homePage.scrollToFooter();
    await expect(homePage.subscriptionHeading).toBeVisible();

    // Subscribe with a random email for the first time and verify success
    const email = randomEmail();
    await homePage.subscribeToNewsletter(email);
    await homePage.verifySubscriptionSuccess();

    // Scroll back to footer and attempt to subscribe again with the same email
    await homePage.scrollToFooter();
    await homePage.subscribeToNewsletter(email);

    // Assert that the success message does NOT appear for the duplicate subscription
    // Using explicit wait to give the site time to respond before concluding it won't appear
    const successAppeared = await homePage.subscribeSuccessMessage
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    expect(
      successAppeared,
      'Success message should not appear for a duplicate email subscription'
    ).toBe(false);
  });
});
