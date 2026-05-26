import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProductsPage extends BasePage {
  readonly searchInput: Locator;
  readonly searchBtn: Locator;
  readonly allProductsHeading: Locator;
  readonly searchedProductsHeading: Locator;
  readonly productNames: Locator;
  readonly salesImage: Locator;
  readonly productCards: Locator;
  readonly continueShoppingBtn: Locator;
  readonly viewCartLink: Locator;
  readonly cartModal: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.locator('#search_product');
    this.searchBtn = page.locator('#submit_search');
    this.allProductsHeading = page.getByRole('heading', { name: 'All Products' });
    this.searchedProductsHeading = page.getByRole('heading', { name: 'Searched Products' });
    this.productNames = page.locator('.productinfo p');
    this.salesImage = page.locator('img[src="/static/images/shop/sale.jpg"]');
    this.productCards = page.locator('.features_items .product-image-wrapper');
    this.continueShoppingBtn = page.locator('button[data-dismiss="modal"]').filter({ hasText: 'Continue Shopping' });
    this.viewCartLink = page.locator('p.text-center a[href="/view_cart"]');
    this.cartModal = page.locator('#cartModal');
  }

  async goto(): Promise<void> {
    await this.navigate('/products');
  }

  async verifyLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/products/);
    await expect(this.allProductsHeading).toBeVisible();
    await expect(this.salesImage).toBeVisible();
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.searchBtn.click();
    await this.page.waitForLoadState('load');
  }

  async getProductNames(): Promise<string[]> {
    await this.productNames.first().waitFor({ state: 'visible' });
    return this.productNames.allTextContents();
  }

  /**
   * Hovers over the product card at the given 0-based index and clicks its 'Add to cart' button.
   */
  async hoverAndAddToCart(index: number): Promise<void> {
    const card = this.productCards.nth(index);
    await card.hover();
    const addBtn = card.locator('.product-overlay .add-to-cart, .productinfo .add-to-cart').first();
    await addBtn.click();
    // Wait for the modal to appear
    await this.cartModal.waitFor({ state: 'visible' });
  }

  async continueShopping(): Promise<void> {
    await this.continueShoppingBtn.click();
    await this.cartModal.waitFor({ state: 'hidden' });
  }

  async clickViewCart(): Promise<void> {
    await this.viewCartLink.click();
    await this.page.waitForLoadState('load');
  }

  /**
   * Navigates to a specific product's detail page by product index (1-based id in URL).
   * Reads the product id from the "View Product" link on the given card index (0-based).
   */
  async getProductIdFromCard(index: number): Promise<string> {
    const card = this.productCards.nth(index);
    const viewLink = card.locator('a[href*="/product_details/"]').first();
    const href = (await viewLink.getAttribute('href')) ?? '';
    const match = href.match(/\/product_details\/(\d+)/);
    return match ? match[1] : '';
  }
}
