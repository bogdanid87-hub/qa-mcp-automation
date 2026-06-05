import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class ContactUsPage extends SitePage {
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly subjectInput: Locator;
  readonly messageTextarea: Locator;
  readonly submitButton: Locator;
  readonly uploadFileInput: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.nameInput = page.locator('[data-qa="name"]');
    this.emailInput = page.locator('[data-qa="email"]');
    this.subjectInput = page.locator('[data-qa="subject"]');
    this.messageTextarea = page.locator('[data-qa="message"]');
    this.submitButton = page.locator('[data-qa="submit-button"]');
    this.uploadFileInput = page.locator('input[name="upload_file"]');
    this.successMessage = page.locator('.status.alert.alert-success [div]');
  }

  async fillContactForm(name: string, email: string, subject: string, message: string, filePath: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.subjectInput.fill(subject);
    await this.messageTextarea.fill(message);
    await this.uploadFileInput.setInputFiles(filePath);
  }

  async submitForm(): Promise<void> {
    await Promise.all([this.page.waitForLoadState('domcontentloaded'), this.submitButton.click()]);
  }

  async verifySuccessMessage(): Promise<void> {
    await expect(this.successMessage).toHaveText('Success! Your details have been submitted successfully.');
  }
}