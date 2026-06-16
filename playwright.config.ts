import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Functional tests live under tests/; visual regression tests under tests/visual/
  testDir: './tests',
  // Each test gets an isolated browser context — fully independent and parallel-safe.
  // Workers: auto (cpus/2) locally; 2 on CI where runners are shared.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'https://automationexercise.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Visual regression thresholds — 1% pixel ratio allows for antialiasing and
  // minor subpixel differences without hiding real layout regressions.
  // TODO: tighten by switching to Docker-consistent CI baselines if false
  // positives appear from OS font rendering differences.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },

  projects: [
    // ── Setup ─────────────────────────────────────────────────────────────────
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },

    // ── Functional browser projects ────────────────────────────────────────────
    // npm test / npm run test:chromium — default fast run
    {
      name: 'chromium',
      testIgnore: /tests\/visual\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        storageState: 'test-data/.auth/guest.json',
        launchOptions: { args: ['--disable-blink-features=AutomationControlled'] },
      },
      dependencies: ['setup'],
    },
    // npm run test:firefox — cross-browser functional validation
    {
      name: 'firefox',
      testIgnore: /tests\/visual\/.*/,
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'test-data/.auth/guest.json',
      },
      dependencies: ['setup'],
    },
    // npm run test:webkit — Safari (WebKit) functional validation
    {
      name: 'webkit',
      testIgnore: /tests\/visual\/.*/,
      use: {
        ...devices['Desktop Safari'],
        storageState: 'test-data/.auth/guest.json',
      },
      dependencies: ['setup'],
    },

    // ── Visual regression project ──────────────────────────────────────────────
    // Chromium only — baselines are browser+OS specific; mixing browsers causes
    // false positives from font rendering differences.
    // npm run test:visual        → compare against committed baselines
    // npm run test:update-snapshots → regenerate baselines after intentional UI changes
    {
      name: 'visual',
      testDir: './tests/visual',
      // Demo site is slow on CI runners; 30s default is not enough for navigation + waitFor
      timeout: 60000,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        storageState: 'test-data/.auth/guest.json',
      },
      dependencies: ['setup'],
      // Visual tests are sequential — snapshot comparison is order-sensitive
      fullyParallel: false,
    },
  ],
});
