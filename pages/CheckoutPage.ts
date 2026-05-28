import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class CheckoutPage extends BasePage {
  readonly registerLoginButton: Locator;
  readonly signupNameInput: Locator;
  readonly signupEmailInput: Locator;
  readonly signupPasswordInput: Locator;
  readonly signupButton: Locator;
  readonly accountCreatedMessage: Locator;
  readonly continueButtonAfterAccountCreation: Locator;
  readonly loggedInUsername: Locator;
  readonly commentTextArea: Locator;
  readonly placeOrderButton: Locator;
  readonly nameOnCardInput: Locator;
  readonly cardNumberInput: Locator;
  readonly cvcInput: Locator;
  readonly expiryMonthInput: Locator;
  readonly expiryYearInput: Locator;
  readonly payAndConfirmOrderButton: Locator;
  readonly orderPlacedMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.registerLoginButton = page.locator('[data-qa="login-button"]');
    this.signupNameInput = page.locator('[data-qa="signup-name"]');
    this.signupEmailInput = page.locator('[data-qa="signup-email"]');
    this.signupPasswordInput = page.locator('[data-qa="signup-password"]');
    this.signupButton = page.locator('[data-qa="signup-button"]');
    this.accountCreatedMessage = page.locator('[data-qa="account-created"]');
    this.continueButtonAfterAccountCreation = page.locator('[data-qa="continue-button"]');
    this.loggedInUsername = page.locator('.navbar-nav li:nth-child(1) a');
    this.commentTextArea = page.locator('textarea[name="message"]');
    this.placeOrderButton = page.locator('[data-qa="place-order"]');
    this.nameOnCardInput = page.locator('[data-qa="name-on-card"]');
    this.cardNumberInput = page.locator('[data-qa="card-number"]');
    this.cvcInput = page.locator('[data-qa="cvc"]');
    this.expiryMonthInput = page.locator('[data-qa="expiry-month"]');
    this.expiryYearInput = page.locator('[data-qa="expiry-year"]');
    this.payAndConfirmOrderButton = page.locator('[data-qa="pay-button"]');
    this.orderPlacedMessage = page.locator('[data-qa="order-placed"]');
  }

  async clickRegisterLogin() {
    await this.registerLoginButton.click();
    await this.page.waitForLoadState('load');
  }

  async signup(name: string, email: string, password: string) {
    await this.signupNameInput.fill(name);
    await this.signupEmailInput.fill(email);
    await this.signupPasswordInput.fill(password);
    await this.signupButton.click();
    await this.page.waitForLoadState('load');
  }

  async verifyAccountCreated() {
    await expect(this.accountCreatedMessage).toBeVisible();
  }

  async clickContinueAfterAccountCreation() {
    await this.continueButtonAfterAccountCreation.click();
    await this.page.waitForLoadState('load');
  }

  async verifyLoggedIn(username: string) {
    await expect(this.loggedInUsername).toHaveText(`Logged in as ${username}`);
  }

  async fillComment(comment: string) {
    await this.commentTextArea.fill(comment);
  }

  async clickPlaceOrder() {
    await this.placeOrderButton.click();
    await this.page.waitForLoadState('load');
  }

  async enterPaymentDetails(nameOnCard: string, cardNumber: string, cvc: string, expiryMonth: string, expiryYear: string) {
    await this.nameOnCardInput.fill(nameOnCard);
    await this.cardNumberInput.fill(cardNumber);
    await this.cvcInput.fill(cvc);
    await this.expiryMonthInput.fill(expiryMonth);
    await this.expiryYearInput.fill(expiryYear);
  }

  async clickPayAndConfirmOrder() {
    await this.payAndConfirmOrderButton.click();
    await this.page.waitForLoadState('load');
  }

  async verifyOrderPlaced() {
    await expect(this.orderPlacedMessage).toBeVisible();
  }
}