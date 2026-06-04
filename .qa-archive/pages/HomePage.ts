import { Page, expect } from '@playwright/test';
import { SitePage } from './SitePage';

export class HomePage extends SitePage {
  constructor(page: Page) {
    super(page);
  }

  async goto(): Promise<void> {
    await this.navigate('/');
  }

  async verifyLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/automationexercise\.com\/?/);
    await expect(this.page.locator('body')).toBeVisible();
    await expect(this.page.locator('#slider')).toBeVisible();
    await expect(this.page.locator('#slider .item img').first()).toBeAttached();
    await expect(this.page.locator('.features_items')).toBeVisible();
  }
}
