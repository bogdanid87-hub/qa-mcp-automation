/**
 * Minimal, dependency-free starter files written by init_project's scaffolding
 * pass. Kept deliberately small — richer helpers (ad-blocking, popup dismissal,
 * trackCleanup) are project-specific enhancements layered on top later, not part
 * of the baseline scaffold.
 */

export { REQUIREMENTS_TEMPLATE } from './requirements-registry.js';
export { MY_TEST_TEMPLATE, PRD_TEMPLATE } from '../workspace.js';

export const BASE_PAGE_TEMPLATE = `import { Page } from '@playwright/test';

/**
 * BasePage — shared navigation for every page object.
 *
 * Extend this only for pages with no site nav/footer (e.g. login, checkout steps).
 * For any full site page, extend SitePage instead.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  async navigate(path: string): Promise<void> {
    await this.page.goto(path);
  }
}
`;

export const SITE_PAGE_TEMPLATE = `import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * SitePage — extend this for any full page of your site.
 *
 * Add locators and methods that are present on EVERY page:
 *   - Navigation bar links
 *   - Footer elements
 *   - Logged-in indicator
 *   - Any persistent header/footer component
 *
 * Run \`npm run audit_site -- --url <your-site>\` to discover which
 * elements are universal before filling this in.
 *
 * TODO: replace the example locators below with your site's real ones.
 */
export class SitePage extends BasePage {
  // TODO: add universal locators here
  // readonly navHome: Locator;
  // readonly navLogin: Locator;
  // readonly loggedInAs: Locator;
  // readonly footer: Locator;

  constructor(page: Page) {
    super(page);
    // TODO: initialise universal locators here
    // this.navHome = page.getByRole('link', { name: 'Home' });
    // this.navLogin = page.getByRole('link', { name: 'Login' });
    // this.loggedInAs = page.locator('.user-info');
    // this.footer = page.locator('footer');
  }

  // TODO: add shared methods here (navigate to common pages, check auth state, etc.)
}
`;

export const LEARNED_RULES_TEMPLATE = `# Learned Rules

Rules discovered by investigating real test failures.
Each rule is injected into the system prompt automatically.

<!-- rules-start -->
<!-- rules-end -->
`;

export const START_HERE_TEMPLATE = `# Start Here

The quickest way to get a real automated test written and checked — no coding
required. For a deeper walkthrough, see docs/getting-started.md.

## 1. Describe the test you want, in plain English

Open \`workspace/my-test.txt\` and replace the example text with what you want
tested — for example:

    Go to the login page, sign in with a valid email and password, and check
    that the account page shows the user's name.

## 2. Generate it

    npm run generate -- --file workspace/my-test.txt

This turns your description into a real Playwright test, writes it to the
project, and runs it.

## 3. Read the result

The command prints one of these for the test it just created:
  - ✅ Passed — done, nothing more to do.
  - 🔧 Auto-fixed — it failed once, fixed itself, and now passes.
  - ⚠️ Broken — couldn't be made to pass automatically; the printed reason
    explains why.
  - 🐞 App bug — the test is correct, but the app itself behaved unexpectedly.

## 4. Check overall health any time

    npm run status

Prints a summary of every test in the project, ending with a "Bottom line" that
says — in plain English — whether anything needs attention, and what command
fixes it.

## Got a list of requirements instead of one test?

Paste them into \`workspace/prd.md\`, then run:

    npm run analyze_prd -- --file workspace/prd.md

This writes a reviewable list of suggested tests to \`workspace/prd-tests.txt\` —
delete anything you don't want, then run:

    npm run generate -- --file workspace/prd-tests.txt

## Something broke later?

    npm run fix

Investigates the most recently broken test and tries to fix it automatically.
`;

export const FIXTURES_INDEX_TEMPLATE = `import { test as base } from '@playwright/test';

/**
 * Custom fixtures — add one fixture per Page Object class.
 *
 * After running audit_site and creating your page classes, import them here
 * and add a fixture entry for each one. Example:
 *
 *   import { HomePage } from '../pages/HomePage';
 *
 *   type PageFixtures = {
 *     homePage: HomePage;
 *   };
 *
 *   export const test = base.extend<PageFixtures>({
 *     homePage: async ({ page }, use) => {
 *       await use(new HomePage(page));
 *     },
 *   });
 */

export const test = base.extend({});

export { expect } from '@playwright/test';
`;
