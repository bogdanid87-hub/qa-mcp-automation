import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class ProductDetailPage extends SitePage {
  readonly quantityInput: Locator;
  readonly productIdInput: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly reviewTextarea: Locator;
  readonly submitReviewButton: Locator;
  readonly addToCartButton: Locator;
  readonly continueShoppingButton: Locator;
  readonly reviewSuccessMessage: Locator;
  readonly productName: Locator;
  readonly productPrice: Locator;
  readonly cartModal: Locator;
  readonly viewCartLink: Locator;

  constructor(page: Page) {
    super(page);
    this.quantityInput = page.locator('#quantity');
    this.productIdInput = page.locator('#product_id');
    this.nameInput = page.locator('#name');
    this.emailInput = page.locator('#email');
    this.reviewTextarea = page.locator('#review');
    this.submitReviewButton = page.locator('#button-review');
    this.addToCartButton = page.getByRole('button', { name: 'Add to cart' });
    this.continueShoppingButton = page.locator('.btn.btn-success.close-modal.btn-block');
    this.reviewSuccessMessage = page.locator('.alert-success.alert', { hasText: 'Thank you for your review.' });
    this.productName = page.locator('.product-information h2');
    this.productPrice = page.locator('.product-information span span');
    this.cartModal = page.locator('#cartModal');
    this.viewCartLink = page.locator('p.text-center a[href="/view_cart"]');
  }

  async getProductName(): Promise<string> {
    await expect(this.productName).toBeVisible();
    return (await this.productName.textContent() ?? '').trim();
  }

  async getPrice(): Promise<number> {
    await expect(this.productPrice).toBeVisible();
    const text = (await this.productPrice.textContent() ?? '').trim();
    if (!text.match(/\d+/)) throw new Error(`Unexpected price format: "${text}"`);
    return parseInt(text.replace(/[^\d]/g, ''), 10);
  }

  async changeQuantity(qty: number): Promise<void> {
    await this.quantityInput.clear();
    await this.quantityInput.fill(String(qty));
  }

  async addToCart(): Promise<void> {
    await this.addToCartButton.click();
    await this.cartModal.waitFor({ state: 'visible' });
  }

  async continueShopping(): Promise<void> {
    await this.continueShoppingButton.click();
    await this.cartModal.waitFor({ state: 'hidden' });
  }

  async goToCart(): Promise<void> {
    await this.viewCartLink.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async submitReview(name: string, email: string, reviewText: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.reviewTextarea.fill(reviewText);
    await this.submitReviewButton.click();
  }
}
