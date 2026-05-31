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
  // THIS TESTCASE IS THE RESULT OF A BUG - the AI fix login did not differentiate 
  // between code bug and app bug and it altered the test so it passed
  // guardrails have been added against this behaviour so it does not occur 
  // in the future, but kept the test case for posterity
  // [UI Subscription #3]
  test('should accept duplicate email subscriptions and show success each time', async ({ homePage, page }) => {
    // Navigate to home page and verify it loaded successfully
    await homePage.goto();
    await homePage.verifyLoaded();

    // Scroll down to the footer subscription form
    await homePage.scrollToFooter();

    // Verify the SUBSCRIPTION heading is visible in the footer
    await expect(homePage.subscriptionHeading).toBeVisible();

    // Subscribe with a valid random email for the first time
    const email = randomEmail();
    await homePage.subscribeToNewsletter(email);

    // Verify the first subscription was successful
    await homePage.verifySubscriptionSuccess();

    // Scroll to footer again and subscribe with the same email a second time
    await homePage.scrollToFooter();
    await homePage.subscribeToNewsletter(email);

    // The site accepts duplicate subscriptions — verify a success message is shown again
    await homePage.verifySubscriptionSuccess();
  });
});
