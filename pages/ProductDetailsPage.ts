import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class ProductDetailsPage extends SitePage {
  readonly quantityInput: Locator;
  readonly productIdInput: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly reviewTextarea: Locator;
  readonly submitReviewButton: Locator;
  readonly continueShoppingButton: Locator;
  readonly successReviewMessage: Locator;
  readonly productName: Locator;
  readonly productPrice: Locator;
  readonly addToCartButton: Locator;
  readonly cartModal: Locator;
  readonly viewCartLink: Locator;

  constructor(page: Page) {
    super(page);
    this.quantityInput        = page.locator('#quantity');
    this.productIdInput       = page.locator('#product_id');
    this.nameInput            = page.locator('#name');
    this.emailInput           = page.locator('#email');
    this.reviewTextarea       = page.locator('#review');
    this.submitReviewButton   = page.locator('#button-review');
    this.continueShoppingButton = page.locator('.btn.btn-success.close-modal.btn-block');
    this.successReviewMessage = page.locator('#review-form .alert-success');
    this.productName          = page.locator('.product-information h2');
    this.productPrice         = page.locator('.product-information span span');
    this.addToCartButton      = page.locator('.product-information .btn.btn-default.cart');
    this.cartModal            = page.locator('#cartModal');
    this.viewCartLink         = page.locator('#cartModal p.text-center a[href="/view_cart"]');
  }

  async goto(productId: number): Promise<void> {
    await this.navigate(`/product_details/${productId}`, );
  }

  async verifyLoaded(): Promise<void> {
    await this.page.waitForURL(/\/product_details\/\d+/, { timeout: 10000 });
    await this.productName.waitFor({ state: 'visible' });
  }

  async getProductName(): Promise<string> {
    return (await this.productName.textContent() ?? '').trim();
  }

  async getPrice(): Promise<string> {
    return (await this.productPrice.textContent() ?? '').trim();
  }

  async changeQuantity(qty: number): Promise<void> {
    await this.quantityInput.fill(String(qty));
  }

  async addToCart(): Promise<void> {
    await this.addToCartButton.click();
    await this.cartModal.waitFor({ state: 'visible' });
  }

  async viewCart(): Promise<void> {
    await this.viewCartLink.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Fills in the review form and submits it.
   * Waits for the success alert to become visible.
   */
  async submitReview(name: string, email: string, reviewText: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.reviewTextarea.fill(reviewText);
    await this.submitReviewButton.click();
    await this.successReviewMessage.waitFor({ state: 'visible', timeout: 10000 });
  }

  async verifyReviewSuccess(): Promise<void> {
    await expect(this.successReviewMessage).toBeVisible();
    await expect(this.successReviewMessage).toContainText('Thank you for your review.');
  }
}
