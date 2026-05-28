import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class CheckoutPage extends BasePage {
  readonly registerLoginButton: Locator;
  readonly accountCreatedMessage: Locator;
  readonly continueAfterAccountCreation: Locator;
  readonly loggedInUsername: Locator;
  readonly proceedToCheckoutButton: Locator;
  readonly addressDetailsHeading: Locator;
  readonly reviewYourOrderHeading: Locator;
  readonly commentTextArea: Locator;
  readonly placeOrderButton: Locator;
  readonly nameOnCardInput: Locator;
  readonly cardNumberInput: Locator;
  readonly cvcInput: Locator;
  readonly expiryMonthInput: Locator;
  readonly expiryYearInput: Locator;
  readonly payAndConfirmOrderButton: Locator;
  readonly orderPlacedMessage: Locator;
  readonly deleteAccountButton: Locator;
  readonly accountDeletedMessage: Locator;

  constructor(page: Page) {
    super(page);

    this.registerLoginButton = page.locator('[data-qa="login-button"]').first();
    this.accountCreatedMessage = page.locator('.alert-success.alert', { hasText: 'ACCOUNT CREATED!' });
    this.continueAfterAccountCreation = page.locator('[data-qa="continue-button"]');
    this.loggedInUsername = page.locator('.navbar-nav li a', { hasText: /Logged in as/ });
    this.proceedToCheckoutButton = page.locator('[data-qa="checkout-button"]').first();
    this.addressDetailsHeading = page.locator('h2', { hasText: 'Address Details' });
    this.reviewYourOrderHeading = page.locator('h2', { hasText: 'Review Your Order' });
    this.commentTextArea = page.locator('textarea[name="message"]');
    this.placeOrderButton = page.getByRole('link', { name: /place order/i });
    this.nameOnCardInput = page.locator('[data-qa="name-on-card"]').first();
    this.cardNumberInput = page.locator('[data-qa="card-number"]').first();
    this.cvcInput = page.locator('[data-qa="cvc"]').first();
    this.expiryMonthInput = page.locator('[data-qa="expiry-month"]').first();
    this.expiryYearInput = page.locator('[data-qa="expiry-year"]').first();
    this.payAndConfirmOrderButton = page.locator('[data-qa="pay-button"]');
    this.orderPlacedMessage = page.getByRole('heading', { name: /order placed/i });
    this.deleteAccountButton = page.getByRole('link', { name: /delete account/i });
    this.accountDeletedMessage = page.getByRole('heading', { name: /account deleted/i });
  }

  async verifyLoaded() {
    await expect(this.addressDetailsHeading).toBeVisible();
    await expect(this.reviewYourOrderHeading).toBeVisible();
  }

  async enterComment(comment: string) {
    await this.commentTextArea.fill(comment);
  }

  async placeOrder() {
    await this.placeOrderButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async fillPaymentDetails(nameOnCard: string, cardNumber: string, cvc: string, expiryMonth: string, expiryYear: string) {
    await this.nameOnCardInput.fill(nameOnCard);
    await this.cardNumberInput.fill(cardNumber);
    await this.cvcInput.fill(cvc);
    await this.expiryMonthInput.fill(expiryMonth);
    await this.expiryYearInput.fill(expiryYear);
  }

  async payAndConfirm() {
    await this.payAndConfirmOrderButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async deleteAccount() {
    await this.deleteAccountButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }
}
