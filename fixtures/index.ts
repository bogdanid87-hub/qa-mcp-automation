import { test as base } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { ContactUsPage } from '../pages/ContactUsPage';
import { ProductsPage } from '../pages/ProductsPage';
import { blockAds } from '../utils/adBlocker';
import { dismissPopups } from '../utils/popupDismisser';

type PageFixtures = {
  homePage: HomePage;
  contactUsPage: ContactUsPage;
  productsPage: ProductsPage;
};

export const test = base.extend<PageFixtures>({
  // Override the default page to always block ads and dismiss popups on first load
  page: async ({ page }, use) => {
    await blockAds(page);

    let firstNavigation = true;
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame() && firstNavigation) {
        firstNavigation = false;
        // Give the page a moment to settle before dismissing popups
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await dismissPopups(page).catch(() => {});
      }
    });

    await use(page);
  },

  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },

  contactUsPage: async ({ page }, use) => {
    await use(new ContactUsPage(page));
  },

  productsPage: async ({ page }, use) => {
    await use(new ProductsPage(page));
  },
});

export { expect } from '@playwright/test';
