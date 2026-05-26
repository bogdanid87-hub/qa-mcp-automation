import path from 'path';
import { test, expect } from '../fixtures';
import { randomEmail, randomName, randomString } from '../utils/randomData';

test.describe('Contact Us Form', () => {
  test('should submit the contact form and show success message', async ({ page, homePage, contactUsPage }) => {
    // Step 1-3: Navigate to home and verify it loaded
    await homePage.goto();
    await homePage.verifyLoaded();

    // Step 4: Click Contact Us in the nav
    await homePage.clickContactUs();

    // Step 5: Verify GET IN TOUCH heading is visible
    await contactUsPage.verifyGetInTouchVisible();

    // Step 6: Fill in the contact form with randomised data
    const name = randomName();
    const email = randomEmail();
    const subject = `Test subject ${randomString(6)}`;
    const message = `Automated test message ${randomString(12)}`;
    await contactUsPage.fillForm(name, email, subject, message);

    // Step 7: Upload a file
    const filePath = path.resolve(__dirname, '../test-data/sample-upload.txt');
    await contactUsPage.uploadFile(filePath);

    // Step 8-9: Submit (accepts the JS confirm dialog automatically via dialog handler)
    await contactUsPage.submitForm();

    // Step 10: Verify success message
    await contactUsPage.verifySuccess();

    // Step 11: Click Home and verify the home page loads
    await contactUsPage.clickHome();
    await homePage.verifyLoaded();
  });
});
