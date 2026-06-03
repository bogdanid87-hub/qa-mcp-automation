import { test as base, type Page } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { ContactUsPage } from '../pages/ContactUsPage';
import { ProductsPage } from '../pages/ProductsPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { LoginPage } from '../pages/LoginPage';
import { AccountPage } from '../pages/AccountPage';
import { blockAds } from '../utils/adBlocker';
import { dismissPopups } from '../utils/popupDismisser';

type PageFixtures = {
  homePage: HomePage;
  contactUsPage: ContactUsPage;
  productsPage: ProductsPage;
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
  loginPage: LoginPage;
  accountPage: AccountPage;
  loggedInPage: Page;
};

export const test = base.extend<PageFixtures>({
  // Override the default page to always block ads and dismiss popups on first load
  page: async ({ page }, use) => {
    // Hide automation signals — prevents Cloudflare from serving 403 to the browser
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
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

  cartPage: async ({ page }, use) => {
    await use(new CartPage(page));
  },

  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  accountPage: async ({ page }, use) => {
    await use(new AccountPage(page));
  },

  // Provides a Page instance pre-loaded with logged-in storage state.
  // Use this fixture in tests that require an authenticated session.
  loggedInPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: 'test-data/.auth/loggedIn.json',
    });
    const page = await context.newPage();
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
    await context.close();
  },
});

export { expect } from '@playwright/test';
