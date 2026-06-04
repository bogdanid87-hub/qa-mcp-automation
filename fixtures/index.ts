import { test as base } from '@playwright/test';
import { blockAds } from '../utils/adBlocker';
import { dismissPopups } from '../utils/popupDismisser';

// Minimal fixture — overrides the default `page` to block ads and dismiss popups.
// Page-specific fixtures (homePage, cartPage, etc.) are added here by generate_test
// as tests are created.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await blockAds(page);

    let firstNavigation = true;
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame() && firstNavigation) {
        firstNavigation = false;
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await dismissPopups(page).catch(() => {});
      }
    });

    await use(page);
  },
});

export { expect } from '@playwright/test';
