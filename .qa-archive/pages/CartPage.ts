import { Page, Locator, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export interface CartRow {
  name: string;
  price: string;
  quantity: string;
  total: string;
}

export class CartPage extends SitePage {
  readonly cartTable: Locator;
  readonly cartRows: Locator;
  readonly emptyCartMessage: Locator;
  readonly quantityInput: Locator;
  readonly proceedToCheckoutBtn: Locator;
  readonly checkoutModal: Locator;
  readonly registerLoginLink: Locator;

  constructor(page: Page) {
    super(page);
    this.cartTable = page.locator('#cart_info_table');
    this.cartRows = page.locator('#cart_info_table tbody tr');
    this.emptyCartMessage = page.locator('#empty_cart');
    this.quantityInput = page.locator('.cart_quantity input');
    this.proceedToCheckoutBtn = page.getByText('Proceed To Checkout');
    this.checkoutModal = page.locator('#checkoutModal');
    this.registerLoginLink = page.getByRole('link', { name: /register \/ login/i });
  }

  async goto(): Promise<void> {
    await this.navigate('/view_cart');
  }

  async verifyLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/view_cart/);
    await expect(this.cartTable).toBeVisible();
  }

  async verifyEmpty(): Promise<void> {
    await expect(this.page).toHaveURL(/\/view_cart/);
    const rowCount = await this.cartRows.count();
    if (rowCount === 0) {
      expect(rowCount).toBe(0);
    } else {
      await expect(this.emptyCartMessage).toBeVisible();
    }
  }

  async proceedToCheckout(): Promise<void> {
    await this.proceedToCheckoutBtn.click();
    await this.page.waitForLoadState('load');
  }

  async clickRegisterLogin(): Promise<void> {
    await this.registerLoginLink.click();
    await this.page.waitForLoadState('load');
  }

  async getCartRows(): Promise<CartRow[]> {
    await this.cartRows.first().waitFor({ state: 'visible' });
    const count = await this.cartRows.count();
    const rows: CartRow[] = [];
    for (let i = 0; i < count; i++) {
      const row = this.cartRows.nth(i);
      const name = (await row.locator('.cart_description h4 a').textContent()) ?? '';
      const price = (await row.locator('.cart_price p').textContent()) ?? '';
      const quantity = (await row.locator('.cart_quantity button').textContent()) ?? '';
      const total = (await row.locator('.cart_total p').textContent()) ?? '';
      rows.push({
        name: name.trim(),
        price: price.trim(),
        quantity: quantity.trim(),
        total: total.trim(),
      });
    }
    return rows;
  }

  async getRowPrice(index: number): Promise<number> {
    const row = this.cartRows.nth(index);
    const priceText = (await row.locator('.cart_price p').textContent()) ?? '';
    if (!priceText.match(/\d+/)) throw new Error(`Unexpected price format: "${priceText}"`);
    return parseInt(priceText.replace(/[^\d]/g, ''), 10);
  }

  async getRowTotal(index: number): Promise<number> {
    const row = this.cartRows.nth(index);
    const totalText = (await row.locator('.cart_total p').textContent()) ?? '';
    if (!totalText.match(/\d+/)) throw new Error(`Unexpected total format: "${totalText}"`);
    return parseInt(totalText.replace(/[^\d]/g, ''), 10);
  }

  async setQuantity(rowIndex: number, qty: number): Promise<void> {
    const row = this.cartRows.nth(rowIndex);
    const input = row.locator('.cart_quantity input');
    await input.fill(String(qty));
    await input.press('Enter');
    await this.page.waitForLoadState('load');
  }

  async removeProduct(rowIndex: number): Promise<void> {
    const row = this.cartRows.nth(rowIndex);
    const deleteBtn = row.locator('.cart_delete a');
    await deleteBtn.click();
    await row.waitFor({ state: 'detached' });
  }

  async getRowCount(): Promise<number> {
    return this.cartRows.count();
  }
}
