import { Page, Locator, expect } from '@playwright/test';
import { ProductListPage } from './ProductListPage';

export class ProductsPage extends ProductListPage {
  readonly searchInput: Locator;
  readonly searchBtn: Locator;
  readonly allProductsHeading: Locator;
  readonly searchedProductsHeading: Locator;
  readonly productNames: Locator;
  readonly salesImage: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput            = page.locator('#search_product');
    this.searchBtn              = page.locator('#submit_search');
    this.allProductsHeading     = page.getByRole('heading', { name: 'All Products' });
    this.searchedProductsHeading = page.getByRole('heading', { name: 'Searched Products' });
    this.productNames           = page.locator('.productinfo p');
    this.salesImage             = page.locator('img[src="/static/images/shop/sale.jpg"]');
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
}
