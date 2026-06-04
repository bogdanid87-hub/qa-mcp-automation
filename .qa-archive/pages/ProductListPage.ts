import { Page, Locator } from '@playwright/test';
import { SitePage } from './SitePage';

/**
 * Shared base for pages that display a product card grid:
 * /products, /category_products/:id, /brand_products/:slug
 *
 * Owns the product card grid, cart modal, and related navigation.
 * Page-specific elements (search box, category/brand heading) live
 * in the concrete subclass.
 */
export class ProductListPage extends SitePage {
  readonly productCards: Locator;
  readonly cartModal: Locator;
  readonly continueShoppingBtn: Locator;
  readonly viewCartLink: Locator;

  constructor(page: Page) {
    super(page);
    this.productCards        = page.locator('.features_items .product-image-wrapper');
    this.cartModal           = page.locator('#cartModal');
    this.continueShoppingBtn = page.locator('button[data-dismiss="modal"]').filter({ hasText: 'Continue Shopping' });
    this.viewCartLink        = page.locator('p.text-center a[href="/view_cart"]');
  }

  /**
   * Hover over the product card at the given 0-based index and click its Add to Cart button.
   * Waits for the cart modal to appear.
   */
  async hoverAndAddToCart(index: number): Promise<void> {
    const card = this.productCards.nth(index);
    await card.hover();
    const addBtn = card.locator('.product-overlay .add-to-cart, .productinfo .add-to-cart').first();
    await addBtn.click();
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
   * Read the product ID from the "View Product" link on the card at the given 0-based index.
   */
  async getProductIdFromCard(index: number): Promise<string> {
    const card = this.productCards.nth(index);
    const viewLink = card.locator('a[href*="/product_details/"]').first();
    const href = (await viewLink.getAttribute('href')) ?? '';
    const match = href.match(/\/product_details\/(\d+)/);
    return match ? match[1] : '';
  }
}
