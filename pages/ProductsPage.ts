import { Page, Locator } from '@playwright/test';
import { ProductListPage } from './ProductListPage';

export class ProductsPage extends ProductListPage {
  readonly searchInput: Locator;
  readonly submitSearchButton: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput        = page.locator('#search_product');
    this.submitSearchButton = page.locator('#submit_search');
  }

  async goto(): Promise<void> {
    await this.navigate('/products', );
  }

  async verifyLoaded(): Promise<void> {
    await this.page.waitForURL(/\/products/, { timeout: 10000 });
  }

  /**
   * Returns the product name text for the card at the given 0-based index.
   */
  async getCardProductName(index: number): Promise<string> {
    const card = this.productCards.nth(index);
    const nameEl = card.locator('.productinfo p');
    return (await nameEl.textContent() ?? '').trim();
  }

  /**
   * Returns the price text (e.g. "Rs. 500") for the card at the given 0-based index.
   */
  async getCardPrice(index: number): Promise<string> {
    const card = this.productCards.nth(index);
    const priceEl = card.locator('.productinfo h2');
    return (await priceEl.textContent() ?? '').trim();
  }

  /**
   * Performs a product search and waits for the results to render.
   */
  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.submitSearchButton.click(),
    ]);
  }
}
