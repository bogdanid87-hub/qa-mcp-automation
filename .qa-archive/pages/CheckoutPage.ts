import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class CheckoutPage extends SitePage {
  readonly registerLoginButton: Locator;
  readonly accountCreatedMessage: Locator;
  readonly continueAfterAccountCreation: Locator;
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
    this.registerLoginButton          = page.locator('[data-qa="login-button"]').first();
    this.accountCreatedMessage        = page.locator('.alert-success.alert', { hasText: 'ACCOUNT CREATED!' });
    this.continueAfterAccountCreation = page.locator('[data-qa="continue-button"]');
    this.proceedToCheckoutButton      = page.locator('[data-qa="checkout-button"]').first();
    this.addressDetailsHeading        = page.locator('h2', { hasText: 'Address Details' });
    this.reviewYourOrderHeading       = page.locator('h2', { hasText: 'Review Your Order' });
    this.commentTextArea              = page.locator('textarea[name="message"]');
    this.placeOrderButton             = page.getByRole('link', { name: /place order/i });
    this.nameOnCardInput              = page.locator('[data-qa="name-on-card"]').first();
    this.cardNumberInput              = page.locator('[data-qa="card-number"]').first();
    this.cvcInput                     = page.locator('[data-qa="cvc"]').first();
    this.expiryMonthInput             = page.locator('[data-qa="expiry-month"]').first();
    this.expiryYearInput              = page.locator('[data-qa="expiry-year"]').first();
    this.payAndConfirmOrderButton     = page.locator('[data-qa="pay-button"]');
    this.orderPlacedMessage           = page.getByRole('heading', { name: /order placed/i });
    this.deleteAccountButton          = page.getByRole('link', { name: /delete account/i });
    this.accountDeletedMessage        = page.getByRole('heading', { name: /account deleted/i });
  }

  async verifyLoaded(): Promise<void> {
    await expect(this.addressDetailsHeading).toBeVisible();
    await expect(this.reviewYourOrderHeading).toBeVisible();
  }

  async enterComment(comment: string): Promise<void> {
    await this.commentTextArea.fill(comment);
  }

  async placeOrder(): Promise<void> {
    await this.placeOrderButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async fillPaymentDetails(
    nameOnCard: string, cardNumber: string, cvc: string,
    expiryMonth: string, expiryYear: string,
  ): Promise<void> {
    await this.nameOnCardInput.fill(nameOnCard);
    await this.cardNumberInput.fill(cardNumber);
    await this.cvcInput.fill(cvc);
    await this.expiryMonthInput.fill(expiryMonth);
    await this.expiryYearInput.fill(expiryYear);
  }

  async payAndConfirm(): Promise<void> {
    await this.payAndConfirmOrderButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async deleteAccount(): Promise<void> {
    await this.deleteAccountButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }
}
