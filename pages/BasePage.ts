import { Page } from '@playwright/test';
import { dismissPopups } from '../utils/popupDismisser';

export class BasePage {
  constructor(protected readonly page: Page) {}

  async navigate(path: string, dismissOnLoad = true): Promise<void> {
    await this.page.goto(path);
    if (dismissOnLoad) {
      await dismissPopups(this.page);
    }
  }
}
