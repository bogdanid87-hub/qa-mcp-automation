import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class ContactUsPage extends SitePage {
  readonly heading: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly subjectInput: Locator;
  readonly messageInput: Locator;
  readonly fileUpload: Locator;
  readonly submitBtn: Locator;
  readonly successMessage: Locator;
  readonly homeBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByText('GET IN TOUCH');
    this.nameInput = page.locator('[data-qa="name"]');
    this.emailInput = page.locator('[data-qa="email"]');
    this.subjectInput = page.locator('[data-qa="subject"]');
    this.messageInput = page.locator('[data-qa="message"]');
    this.fileUpload = page.locator('[name="upload_file"]');
    this.submitBtn = page.locator('[data-qa="submit-button"]');
    this.successMessage = page.locator('.status.alert-success');
    // The "Home" button shown after submission is the green btn-success link, not the nav link
    this.homeBtn = page.locator('a.btn-success[href="/"]');
  }

  async verifyGetInTouchVisible(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async fillForm(name: string, email: string, subject: string, message: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.subjectInput.fill(subject);
    await this.messageInput.fill(message);
  }

  async uploadFile(filePath: string): Promise<void> {
    await this.fileUpload.setInputFiles(filePath);
  }

  async submitForm(): Promise<void> {
    this.page.on('dialog', (dialog) => dialog.accept());
    await this.submitBtn.click();
    await this.page.waitForTimeout(3000);
  }

  async verifySuccess(): Promise<void> {
    await expect(this.successMessage).toBeVisible({ timeout: 15000 });
    await expect(this.successMessage).toContainText(
      'Success! Your details have been submitted successfully.',
      { timeout: 15000 },
    );
  }

  async clickHome(): Promise<void> {
    await this.homeBtn.click();
  }
}
