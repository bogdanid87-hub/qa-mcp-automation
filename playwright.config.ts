import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Each test gets an isolated browser context — tests are fully independent
  // and safe to run in parallel. Workers: auto (cpus/2) locally so the setting
  // adapts to the machine; 2 on CI where runners are shared and the target site
  // may throttle concurrent requests.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'https://automationexercise.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        storageState: 'test-data/.auth/guest.json',
      },
      dependencies: ['setup'],
    },
  ],
});
