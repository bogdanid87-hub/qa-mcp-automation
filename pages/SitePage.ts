import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Shared base for all automationexercise.com pages.
 * Owns nav bar, footer subscription form, and logged-in indicator —
 * elements present on every page of the site.
 */
export class SitePage extends BasePage {
  readonly logo: Locator;
  readonly navContactUs: Locator;
  readonly navProducts: Locator;
  readonly loggedInAs: Locator;
  readonly footer: Locator;
  readonly subscriptionHeading: Locator;
  readonly subscribeEmailInput: Locator;
  readonly subscribeBtn: Locator;
  readonly subscribeSuccessMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.logo                   = page.locator('[data-qa="logo"], img[alt="Website for automation practice"]').first();
    this.navContactUs           = page.getByRole('link', { name: 'Contact us' });
    this.navProducts            = page.locator('a[href="/products"]');
    this.loggedInAs             = page.locator('.navbar-nav li a', { hasText: /Logged in as/ });
    this.footer                 = page.locator('#footer');
    this.subscriptionHeading    = page.getByRole('heading', { name: 'Subscription' });
    this.subscribeEmailInput    = page.locator('#susbscribe_email');
    this.subscribeBtn           = page.locator('#subscribe');
    this.subscribeSuccessMessage = page.locator('.alert-success.alert');
  }

  async scrollToFooter(): Promise<void> {
    await this.footer.scrollIntoViewIfNeeded();
  }

  async subscribeToNewsletter(email: string): Promise<void> {
    await this.subscribeEmailInput.fill(email);
    await this.subscribeBtn.click();
  }

  async verifySubscriptionSuccess(): Promise<void> {
    await expect(this.subscribeSuccessMessage).toBeVisible({ timeout: 10000 });
    await expect(this.subscribeSuccessMessage).toContainText('You have been successfully subscribed!');
  }

  async clickContactUs(): Promise<void> {
    await this.navContactUs.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickProducts(): Promise<void> {
    await this.navProducts.click();
    await this.page.waitForLoadState('domcontentloaded');
  }
}
