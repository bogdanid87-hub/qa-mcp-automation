import { test, expect } from '../../fixtures';
import { ContactUsPage } from '../../pages/ContactUsPage';
import { TEST_USER } from '../../test-data/constants';
import * as path from 'path';

test.describe('Contact Us', () => {
  // [UI Contact Us #1]
  test('should submit contact form with file attachment and show success message @smoke @regression', async ({ page }) => {
    const contactPage = new ContactUsPage(page);

    // Navigate to the Contact Us page
    await page.goto('/contact_us', { waitUntil: 'domcontentloaded' });

    // Verify the Contact Us heading is visible
    await expect(page.getByRole('heading', { name: 'Get In Touch' })).toBeVisible();

    // Resolve the upload file path — using a sample file from test-data/
    const filePath = path.resolve(__dirname, '../../test-data/sample-upload.txt');

    // Fill in the contact form fields and attach a file
    await contactPage.fillContactForm(
      TEST_USER.name,
      TEST_USER.email(),
      'Test Subject from Playwright',
      'This is an automated test message sent via Playwright.',
      filePath
    );

    // Register dialog handler before clicking submit (confirm dialog may appear)
    page.on('dialog', (dialog) => dialog.accept());

    // Submit the form
    await contactPage.submitForm();

    // Wait for success message to become visible
    const successDiv = page.locator('.status.alert.alert-success');
    await successDiv.waitFor({ state: 'visible' });

    // Verify the success confirmation message text
    await expect(successDiv).toContainText('Success! Your details have been submitted successfully.');
  });
});
