import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  readonly logo: Locator;
  readonly navContactUs: Locator;
  readonly navProducts: Locator;
  readonly subscriptionHeading: Locator;
  readonly subscribeEmailInput: Locator;
  readonly subscribeBtn: Locator;
  readonly subscribeSuccessMessage: Locator;
  readonly footer: Locator;
  readonly loggedInAs: Locator;

  constructor(page: Page) {
    super(page);
    this.logo = page.locator('[data-qa="logo"], img[alt="Website for automation practice"]').first();
    this.navContactUs = page.getByRole('link', { name: 'Contact us' });
    this.navProducts = page.locator('a[href="/products"]');
    this.subscriptionHeading = page.getByRole('heading', { name: 'Subscription' });
    this.subscribeEmailInput = page.locator('#susbscribe_email');
    this.subscribeBtn = page.locator('#subscribe');
    this.subscribeSuccessMessage = page.locator('.alert-success.alert');
    this.footer = page.locator('#footer');
    this.loggedInAs = page.locator('.navbar-nav li a', { hasText: /Logged in as/ });
  }

  async goto(): Promise<void> {
    await this.navigate('/');
  }

  async verifyLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/automationexercise\.com\/?/);
    await expect(this.page.locator('body')).toBeVisible();
    await expect(this.page.locator('#slider')).toBeVisible();
    await expect(this.page.locator('#slider .item img').first()).toBeAttached();
    await expect(this.page.locator('.features_items')).toBeVisible();
  }

  async clickContactUs(): Promise<void> {
    await this.navContactUs.click();
    // Wait for the new page's load event so inline scripts (e.g. jQuery handlers) are attached
    await this.page.waitForLoadState('load');
  }

  async clickProducts(): Promise<void> {
    await this.navProducts.click();
    await this.page.waitForLoadState('load');
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
}
