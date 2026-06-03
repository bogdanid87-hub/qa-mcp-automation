import { test as setup, chromium } from '@playwright/test';
import path from 'path';
import { blockAds } from '../utils/adBlocker';
import { dismissPopups } from '../utils/popupDismisser';

// Hides automation signals so Cloudflare issues a real clearance cookie.
// The CF clearance cookie saved here is then used by the request fixture
// in API tests (via storageState), allowing them to bypass the 403 block.
const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];
const stealthScript = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
};

const guestStorageState = path.join(__dirname, '../test-data/.auth/guest.json');

setup('save guest storage state', async () => {
  const browser = await chromium.launch({ args: STEALTH_ARGS });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(stealthScript);

  await blockAds(page);
  await page.goto('/');
  await dismissPopups(page);

  await context.storageState({ path: guestStorageState });
  await browser.close();
});

const loggedInStorageState = path.join(__dirname, '../test-data/.auth/loggedIn.json');

setup('save logged-in storage state', async () => {
  if (!process.env.TEST_EMAIL || !process.env.TEST_PASSWORD) {
    console.warn(
      'TEST_EMAIL and TEST_PASSWORD environment variables are not set. Skipping logged-in storage state setup.'
    );
    // Write an empty (guest-equivalent) storage state so downstream tests that
    // depend on the file path don't crash with a missing-file error.
    const browser = await chromium.launch();
    const context = await browser.newContext();
    await context.storageState({ path: loggedInStorageState });
    await browser.close();
    return;
  }

  const browser = await chromium.launch({ args: STEALTH_ARGS });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(stealthScript);

  await blockAds(page);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissPopups(page);

  await page.locator('[data-qa="login-email"]').fill(process.env.TEST_EMAIL);
  await page.locator('[data-qa="login-password"]').fill(process.env.TEST_PASSWORD);
  await page.locator('[data-qa="login-button"]').click();

  await page.waitForLoadState('domcontentloaded');

  // Wait for the nav bar to confirm successful login
  await page.locator('.navbar-nav li a').first().waitFor({ state: 'visible' });

  await context.storageState({ path: loggedInStorageState });
  await browser.close();
});
