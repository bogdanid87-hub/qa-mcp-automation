import { test as setup, chromium } from '@playwright/test';
import path from 'path';
import { blockAds } from '../utils/adBlocker';
import { dismissPopups } from '../utils/popupDismisser';

const guestStorageState = path.join(__dirname, '../test-data/.auth/guest.json');

setup('save guest storage state', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await blockAds(page);
  await page.goto('/');
  await dismissPopups(page);

  await context.storageState({ path: guestStorageState });
  await browser.close();
});
