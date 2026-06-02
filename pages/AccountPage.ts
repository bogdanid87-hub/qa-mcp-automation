import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class AccountPage extends SitePage {
  readonly accountCreatedMessage: Locator;
  readonly continueButtonAfterCreation: Locator;
  readonly deleteAccountButton: Locator;
  readonly accountDeletedMessage: Locator;
  readonly continueButtonAfterDeletion: Locator;

  constructor(page: Page) {
    super(page);
    this.accountCreatedMessage      = page.locator('[data-qa="account-created"]');
    this.continueButtonAfterCreation = page.locator('[data-qa="continue-button"]').first();
    this.deleteAccountButton        = page.locator('[data-qa="delete-account"]');
    this.accountDeletedMessage      = page.locator('[data-qa="account-deleted"]');
    // Each button appears on a different page (created vs deleted) — only one exists at a time.
    this.continueButtonAfterDeletion = page.locator('[data-qa="continue-button"]').first();
  }

  async fillAccountDetails(details: {
    password: string;
    firstName: string;
    lastName: string;
    address: string;
    country: string;
    state: string;
    city: string;
    zipcode: string;
    mobileNumber: string;
  }): Promise<void> {
    await this.page.locator('[data-qa="password"]').fill(details.password);
    await this.page.locator('[data-qa="first_name"]').fill(details.firstName);
    await this.page.locator('[data-qa="last_name"]').fill(details.lastName);
    await this.page.locator('[data-qa="address"]').fill(details.address);
    await this.page.locator('[data-qa="country"]').selectOption(details.country);
    await this.page.locator('[data-qa="state"]').fill(details.state);
    await this.page.locator('[data-qa="city"]').fill(details.city);
    await this.page.locator('[data-qa="zipcode"]').fill(details.zipcode);
    await this.page.locator('[data-qa="mobile_number"]').fill(details.mobileNumber);
  }

  async createAccount(): Promise<void> {
    await this.page.locator('[data-qa="create-account"]').click();
    await this.page.waitForLoadState('load');
  }

  async verifyAccountCreated(): Promise<void> {
    await expect(this.accountCreatedMessage).toBeVisible();
  }

  async clickContinue(): Promise<void> {
    await this.continueButtonAfterCreation.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickContinueAfterCreation(): Promise<void> {
    await this.continueButtonAfterCreation.click();
  }

  async verifyLoggedIn(username: string): Promise<void> {
    await expect(this.loggedInAs).toHaveText(new RegExp(`Logged in as ${username}`));
  }

  async deleteAccount(): Promise<void> {
    await this.deleteAccountButton.click();
  }

  async verifyAccountDeleted(): Promise<void> {
    await expect(this.accountDeletedMessage).toBeVisible();
  }

  async clickContinueAfterDeletion(): Promise<void> {
    await this.continueButtonAfterDeletion.click();
  }
}
