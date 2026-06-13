import { test as base } from '@playwright/test';
import { blockAds } from '../utils/adBlocker';
import { dismissPopups } from '../utils/popupDismisser';

type CleanupFn = () => void | Promise<void>;

// Minimal fixture — overrides the default `page` to block ads and dismiss popups.
// Page-specific fixtures (homePage, cartPage, etc.) are added here by generate_test
// as tests are created.
export const test = base.extend<{ trackCleanup: (fn: CleanupFn) => void }>({
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

  // Cleanup registry for data created during a test (accounts, cart items,
  // uploaded files, etc.). Register a cleanup immediately after creating the
  // entity — this teardown runs after the test regardless of pass/fail, in
  // reverse registration order, with each entry's failure swallowed so it
  // doesn't block the rest.
  trackCleanup: async ({}, use) => {
    const cleanups: CleanupFn[] = [];
    await use((fn) => { cleanups.push(fn); });
    while (cleanups.length) {
      const fn = cleanups.pop()!;
      try {
        await fn();
      } catch {
        // best-effort — entity may already be gone
      }
    }
  },
});

export { expect } from '@playwright/test';
