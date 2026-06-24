# Showcase — one engine, three very different real projects

The engine's headline claim is *"drop it into any existing Playwright project and it
generates tests in **that project's** house style."* This page proves it on three real,
**independently-authored** open-source projects with deliberately different conventions —
including one that hadn't been touched in **five years**. Nothing here was adapted to suit
the engine; the engine adapted to each of them.

Every spec below is a real captured run — two generated tests per project.

## The three projects

| Project | Age | Target site | House style |
|---|---|---|---|
| [ecureuill/saucedemo-playwright](https://github.com/ecureuill/saucedemo-playwright) | ~2.5 yrs | saucedemo.com | POMs in **`tests/pages/`**, `abstract class BasePage`, **`new`-instantiation**, no fixtures, JSON data files |
| [automationexercise-playwright](https://github.com/bogdanid87-hub/automationexercise-playwright) | maintained | automationexercise.com | `pages/` + `fixtures/index.ts`, **collapsed** hierarchy, **fixture-injection**, an **`ApiClient`** abstraction, `data/testData.ts` |
| [andrewbayd/playwright-page-object](https://github.com/andrewbayd/playwright-page-object) | **~5 yrs** | angular.realworld.io | flat POMs (no base class), **no fixtures**, `new`-instantiation, kebab-case files |

Three different sites, three different layouts, three different test-authoring styles.

---

## Step 1 — `learn_conventions` reads each project (token-free)

Run against each project untouched, the detector reports each project's actual conventions:

| What it detected | ecureuill (saucedemo) | AutomationExercise | andrewbayd (realworld) |
|---|---|---|---|
| POM directory | **`tests/pages`** (non-standard) | `pages` | `pages` |
| Base / hierarchy | `BasePage`, collapsed, 7 pages | `BasePage`, collapsed, 1 intermediate, 14 pages, 1 component | `HomePage`, flat, 4 pages |
| Fixtures | none | **16 injected**, no `trackCleanup` | none |
| POM consumption | **instantiation** | **fixture-injection** | **instantiation** |
| API style | none | **mixed (ApiClient)** | none |
| Runner projects | setup / e2e / visual / UI | chromium / api | Chrome / Firefox / WebKit |

The configurable `pom.dir` carries `tests/pages` through the whole engine; the rest is
written into `config.prompts.conventions` so generation follows it.

---

## Step 2 — `generate_test` matches each project's style

The same kinds of prompts — *"log in and verify the landing page"*, plus one feature test —
produce code that looks like it belongs in each codebase. Two per project:

### saucedemo — `new`-instantiation, `@playwright/test`, `tests/pages`, JSON data

**1. Log in as a standard user**

```typescript
import test, { expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { InventoryPage } from "../pages/InventoryPage";

let loginPage: LoginPage;
let inventoryPage: InventoryPage;

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page);                 // ← instantiation
  inventoryPage = new InventoryPage(page);
  await loginPage.visit();
});

test.describe('Sign In', () => {
  test('Should log in with standard user and show inventory page @smoke @regression', async ({ page }) => {
    await loginPage.login('standard_user', 'secret_sauce');
    await inventoryPage.toBe();
    await expect(inventoryPage.locatorHeaderTitle).toBeVisible();
  });
});
```

**2. Sort the inventory Z→A** — reuses the project's `SortOptions` enum and `products.json`:

```typescript
import { test, expect } from '@playwright/test';
import { InventoryPage } from '../pages/InventoryPage';
import { SortOptions } from '../fixtures/models';
import data from '../fixtures/data/products.json';

test.describe('Inventory Sort', () => {
  test('Should sort products from Z to A after login as standard_user @regression', async ({ page }) => {
    const inventoryPage = new InventoryPage(page);           // ← instantiation
    await page.goto('/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login-button');

    await inventoryPage.sort(SortOptions.ZA);                // ← the project's enum
    const expectedFirst = data.za[0].name;                  // ← the project's JSON data
    // …assert first/last items match the Z-to-A order…
  });
});
```

### AutomationExercise — fixture-injection, custom fixtures module, `ApiClient`

**1. Product search** — fixture-injection (`{ productsPage }`), no `new`:

```typescript
import { test, expect } from '../../fixtures/index';

test.describe('Product Search', () => {
  test('should display matching products when searching for "dress" @smoke @regression', async ({ productsPage }) => {
    await productsPage.goto();                               // ← injected fixture
    await productsPage.searchFor('dress');
    await expect(productsPage.searchedProductsHeader).toBeVisible();

    const count = await productsPage.getProductCount();
    expect(count, 'search for "dress" should return at least one product').toBeGreaterThan(0);

    const productNames = await productsPage.getProductNames();
    productNames.forEach(name => {
      expect(name.toLowerCase()).toContain('dress');
    });
  });
});
```

**2. Login API** — the project's body-`responseCode` API convention; this one was generated
**and run live, passing against the real API**:

```typescript
import { test, expect } from '../../fixtures';
import type { APIResponse } from '@playwright/test';

test.describe('Auth API', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/createAccount', { form: { /* full required account fields */ } });
  });
  test.afterAll(async ({ request }) => {
    await request.delete('/api/deleteAccount', { form: { email: testEmail, password: testPassword } });
  });

  test('should verify login with valid credentials @smoke @critical', async ({ request }) => {
    const response = await request.post('/api/verifyLogin', { form: { email: testEmail, password: testPassword } });
    expect(response.status()).toBe(200);                    // ← transport is always 200…
    const body = await response.json();
    expect(body.responseCode).toBe(200);                    // ← …real result is in the body
    expect(body.message).toBe('User exists!');
  });
});
```

### andrewbayd — flat POMs, no fixtures, `new`-instantiation, kebab-case files

**1. Sign in**

```typescript
import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home-page';
import { LoginPage } from '../pages/login-page';
import testdata from './testdata';

test.describe('Login', () => {
  test('should sign in with valid credentials and show Your Feed @smoke @regression', async ({ page }) => {
    const loginPage = new LoginPage(page);                  // ← instantiation
    const homePage = new HomePage(page);

    await loginPage.goto();
    await loginPage.login(testdata.email, testdata.password);

    const isLoggedIn = await homePage.yourFeedIsVisible();  // ← the project's own method name
    expect(isLoggedIn).toBe(true);
  });
});
```

**2. Log out via Settings** — reuses four of the project's flat POMs:

```typescript
import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home-page';
import { LoginPage } from '../pages/login-page';
import { LogoutPage } from '../pages/logout-page';
import { SettingsPage } from '../pages/settings-page';

test.describe('Logout', () => {
  test('should log out from settings and see Sign in link @smoke @regression', async ({ page }) => {
    const homePage = new HomePage(page);
    const loginPage = new LoginPage(page);
    const settingsPage = new SettingsPage(page);
    const logoutPage = new LogoutPage(page);

    await homePage.open();
    await homePage.goToLoginPage();
    await loginPage.login('test@example.com', 'password123');

    await homePage.goToSettings();
    await settingsPage.logout();

    const isLoggedOut = await logoutPage.userIsLoggedOut();
    expect(isLoggedOut).toBe(true);
  });
});
```

Opposite conventions across the board — `new` vs injection, `@playwright/test` vs a custom
fixtures module, raw assertions vs an `ApiClient` — all produced from the **same engine**,
because each run picked up its own project's detected conventions.

---

## Reproduce it

```bash
git clone https://github.com/ecureuill/saucedemo-playwright && cd saucedemo-playwright
npm install -D @bogdanid87/qa-mcp-engine
npx qa-init --name saucedemo --url https://www.saucedemo.com
npx qa-learn --apply-pom --apply-conventions --write   # detects tests/pages + instantiation + no-fixtures
# then ask generate_test (in Claude Code) for any login/cart/checkout test
```

See [docs/learn-conventions.md](../learn-conventions.md) for what's detected and
[docs/install-as-dependency.md](../install-as-dependency.md#existing-playwright-project-already-have-tests)
for the existing-project flow.
