import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class AccountPage extends BasePage {
  readonly accountCreatedMessage: Locator;
  readonly continueButtonAfterCreation: Locator;
  readonly loggedInUsername: Locator;
  readonly deleteAccountButton: Locator;
  readonly accountDeletedMessage: Locator;
  readonly continueButtonAfterDeletion: Locator;

  constructor(page: Page) {
    super(page);
    this.accountCreatedMessage = page.locator('[data-qa="account-created"]');
    this.continueButtonAfterCreation = page.locator('[data-qa="continue-button"]').first();
    this.loggedInUsername = page.locator('.navbar-nav li a', { hasText: /Logged in as/ });
    this.deleteAccountButton = page.locator('[data-qa="delete-account"]');
    this.accountDeletedMessage = page.locator('[data-qa="account-deleted"]');
    this.continueButtonAfterDeletion = page.locator('[data-qa="continue-button"]').last();
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

  async verifyAccountCreated() {
    await expect(this.accountCreatedMessage).toBeVisible();
  }

  async clickContinue(): Promise<void> {
    await this.continueButtonAfterCreation.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickContinueAfterCreation() {
    await this.continueButtonAfterCreation.click();
  }

  async verifyLoggedIn(username: string) {
    await expect(this.loggedInUsername).toHaveText(new RegExp(`Logged in as ${username}`));
  }

  async deleteAccount() {
    await this.deleteAccountButton.click();
  }

  async verifyAccountDeleted() {
    await expect(this.accountDeletedMessage).toBeVisible();
  }

  async clickContinueAfterDeletion() {
    await this.continueButtonAfterDeletion.click();
  }
}