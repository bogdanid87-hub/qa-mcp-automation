import { Page, Locator } from '@playwright/test';
import { SitePage } from './SitePage';

export class ViewCartPage extends SitePage {
  readonly cartTable: Locator;
  readonly cartRows: Locator;
  readonly emptyCartMessage: Locator;
  readonly proceedToCheckoutBtn: Locator;
  readonly checkoutModal: Locator;
  readonly checkoutModalRegisterLoginLink: Locator;
  readonly checkoutModalContinueBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.cartTable            = page.locator('#cart_info_table');
    this.cartRows             = page.locator('#cart_info_table tbody tr');
    this.emptyCartMessage     = page.locator('#empty_cart');
    this.proceedToCheckoutBtn = page.getByText('Proceed To Checkout');
    this.checkoutModal                = page.locator('#checkoutModal');
    this.checkoutModalRegisterLoginLink = page.locator('#checkoutModal a[href="/login"]');
    this.checkoutModalContinueBtn     = page.locator('#checkoutModal .btn.btn-success');
  }

  async goto(): Promise<void> {
    await this.navigate('/view_cart', { waitUntil: 'domcontentloaded' });
  }

  async verifyLoaded(): Promise<void> {
    await this.page.waitForURL(/\/view_cart/, { timeout: 10000 });
  }

  /**
   * Clicks the Proceed To Checkout button and waits for the checkout modal to appear.
   */
  async clickProceedToCheckout(): Promise<void> {
    await this.proceedToCheckoutBtn.click();
    await this.checkoutModal.waitFor({ state: 'visible' });
  }

  /**
   * Returns the product name text for the cart row at the given 0-based index.
   */
  async getRowProductName(index: number): Promise<string> {
    const row = this.cartRows.nth(index);
    const nameLink = row.locator('.cart_description h4 a');
    return (await nameLink.textContent() ?? '').trim();
  }

  /**
   * Returns the unit price string (e.g. "Rs. 500") for the cart row at the given 0-based index.
   */
  async getRowUnitPrice(index: number): Promise<string> {
    const row = this.cartRows.nth(index);
    const priceEl = row.locator('.cart_price p');
    return (await priceEl.textContent() ?? '').trim();
  }

  /**
   * Returns the quantity value for the cart row at the given 0-based index.
   */
  async getRowQuantity(index: number): Promise<number> {
    const row = this.cartRows.nth(index);
    const qtyEl = row.locator('.cart_quantity button');
    const text = (await qtyEl.textContent() ?? '').trim();
    return parseInt(text, 10);
  }

  /**
   * Returns the row total price string (e.g. "Rs. 500") for the cart row at the given 0-based index.
   */
  async getRowTotal(index: number): Promise<string> {
    const row = this.cartRows.nth(index);
    const totalEl = row.locator('.cart_total p');
    return (await totalEl.textContent() ?? '').trim();
  }

  /**
   * Clicks the delete (×) button for the cart row at the given 0-based index
   * and waits for the row to be removed from the DOM.
   */
  async deleteRow(index: number): Promise<void> {
    const row = this.cartRows.nth(index);
    const deleteBtn = row.locator('a.cart_quantity_delete');
    await deleteBtn.click();
    await row.waitFor({ state: 'detached' });
  }
}
