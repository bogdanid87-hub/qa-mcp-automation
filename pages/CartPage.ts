import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export interface CartRow {
  name: string;
  price: string;
  quantity: string;
  total: string;
}

export class CartPage extends BasePage {
  readonly cartTable: Locator;
  readonly cartRows: Locator;
  readonly emptyCartMessage: Locator;
  readonly quantityInput: Locator;

  constructor(page: Page) {
    super(page);
    this.cartTable = page.locator('#cart_info_table');
    this.cartRows = page.locator('#cart_info_table tbody tr');
    this.emptyCartMessage = page.locator('#empty_cart');
    this.quantityInput = page.locator('.cart_quantity input');
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
    // Either the cart table has no rows, or an empty-cart element is shown
    const rowCount = await this.cartRows.count();
    if (rowCount === 0) {
      // Table exists but is empty — acceptable empty state
      expect(rowCount).toBe(0);
    } else {
      // Fallback: check for a visible empty cart message
      await expect(this.emptyCartMessage).toBeVisible();
    }
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

  /**
   * Returns the price (as a number) of the cart row at the given 0-based index.
   */
  async getRowPrice(index: number): Promise<number> {
    const row = this.cartRows.nth(index);
    const priceText = (await row.locator('.cart_price p').textContent()) ?? '';
    return parseInt(priceText.replace(/[^\d]/g, ''), 10);
  }

  /**
   * Returns the total (as a number) of the cart row at the given 0-based index.
   */
  async getRowTotal(index: number): Promise<number> {
    const row = this.cartRows.nth(index);
    const totalText = (await row.locator('.cart_total p').textContent()) ?? '';
    return parseInt(totalText.replace(/[^\d]/g, ''), 10);
  }

  /**
   * Changes the quantity of the cart row at the given 0-based index by directly
   * navigating to the product detail page URL embedded in the row and adding the
   * desired quantity. Since automationexercise.com does not provide an inline
   * quantity editor in the cart, we use the cart row's quantity button text to
   * read the current state and the delete+re-add flow is not used here.
   *
   * Instead this method uses the quantity input that IS present on the cart page
   * for the given row.
   */
  async setQuantity(rowIndex: number, qty: number): Promise<void> {
    const row = this.cartRows.nth(rowIndex);
    const input = row.locator('.cart_quantity input');
    await input.fill(String(qty));
    await input.press('Enter');
    await this.page.waitForLoadState('load');
  }

  /**
   * Clicks the delete/remove icon for the cart row at the given 0-based index.
   */
  async removeProduct(rowIndex: number): Promise<void> {
    const row = this.cartRows.nth(rowIndex);
    const deleteBtn = row.locator('.cart_delete a');
    await deleteBtn.click();
    await this.page.waitForTimeout(1500);
  }

  /**
   * Returns the number of rows currently visible in the cart tbody.
   */
  async getRowCount(): Promise<number> {
    return this.cartRows.count();
  }
}
