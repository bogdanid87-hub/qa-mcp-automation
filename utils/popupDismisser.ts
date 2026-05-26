import { Page } from '@playwright/test';

/**
 * Dismisses cookie banners and consent popups common on automationexercise.com.
 * Called once after the first navigation / page load in a test.
 */
export async function dismissPopups(page: Page): Promise<void> {
  // Google consent iframe "Accept all" button
  const consentFrame = page.frameLocator('iframe[src*="consent"]');
  const acceptBtn = consentFrame.getByRole('button', { name: /accept all/i });
  if (await acceptBtn.isVisible().catch(() => false)) {
    await acceptBtn.click();
  }

  // Generic cookie / modal dismiss
  const genericDismiss = page.getByRole('button', { name: /accept|agree|got it|close/i });
  if (await genericDismiss.first().isVisible().catch(() => false)) {
    await genericDismiss.first().click();
  }
}
