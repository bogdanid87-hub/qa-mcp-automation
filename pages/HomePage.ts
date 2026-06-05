import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class HomePage extends SitePage {
  readonly navHome: Locator;
  readonly navCart: Locator;
  readonly navLogin: Locator;
  readonly testCasesButton: Locator;
  readonly navVideoTutorials: Locator;
  readonly subscribeEmailInput: Locator;
  readonly subscribeBtn: Locator;
  readonly subscribeSuccessMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.navHome           = page.locator('a[href="/home"]').first();
    this.navCart           = page.locator('a[href="/view_cart"]').first();
    this.navLogin          = page.locator('a[href="/login"]').first();
    this.testCasesButton   = page.locator('a[href="/test_cases"]').first();
    this.navVideoTutorials = page.locator('a[href="https://www.youtube.com/c/AutomationExercise"]').first();
    this.subscribeEmailInput = page.locator('#susbscribe_email');
    this.subscribeBtn      = page.locator('#subscribe');
    this.subscribeSuccessMessage = page.locator('.alert-success.alert', { hasText: 'You have been successfully subscribed!' });
  }

  async scrollToFooter(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  async subscribeToNewsletter(email: string): Promise<void> {
    await this.subscribeEmailInput.fill(email);
    await this.subscribeBtn.click();
  }

  async verifySubscriptionSuccess(): Promise<void> {
    await expect(this.subscribeSuccessMessage).toBeVisible();
  }
}