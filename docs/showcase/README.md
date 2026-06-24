# Showcase — one engine, three very different real projects

The engine's headline claim is *"drop it into any existing Playwright project and it
generates tests in **that project's** house style."* This page proves it on three real,
**independently-authored** open-source projects with deliberately different conventions —
including one that hadn't been touched in **five years**. Nothing here was adapted to suit
the engine; the engine adapted to each of them.

All results below are real captured runs.

## The three projects

| Project | Age | Target site | House style |
|---|---|---|---|
| [ecureuill/saucedemo-playwright](https://github.com/ecureuill/saucedemo-playwright) | ~2.5 yrs | saucedemo.com | POMs in **`tests/pages/`**, `abstract class BasePage`, **`new`-instantiation**, no fixtures, JSON data files |
| [automationexercise-playwright](https://github.com/bogdanid87-hub/automationexercise-playwright) | maintained | automationexercise.com | `pages/` + `fixtures/index.ts`, **collapsed** hierarchy, **fixture-injection**, an **`ApiClient`** abstraction, `data/testData.ts` |
| [andrewbayd/playwright-page-object](https://github.com/andrewbayd/playwright-page-object) | **~5 yrs** | angular.realworld.io | flat POMs (no base class), **no fixtures**, a `framework/` helper module, `new`-instantiation, kebab-case files |

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

The configurable `pom.dir` carried `tests/pages` through the whole engine; the rest was
written into `config.prompts.conventions` so generation follows it.

---

## Step 2 — `generate_test` matches each project's style

The same prompt — *"log in and verify the landing page"* — produces code that looks like it
belongs in each codebase. All three side by side:

**saucedemo** — `new`-instantiation, plain `@playwright/test` import, `tests/pages` layout, the project's component pattern:

```typescript
import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { InventoryPage } from "../pages/InventoryPage";

let loginPage: LoginPage;
test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page);                 // ← instantiation
  await loginPage.visit();
});

test('Should log in with standard_user and see the inventory page @smoke @regression', async ({ page }) => {
  await loginPage.formComponent.login('standard_user', 'secret_sauce');  // ← the project's component
  await inventoryPage.toBe();
  await expect(inventoryPage.locatorHeaderTitle).toBeVisible();
});
```

**AutomationExercise** — fixture-injection, the project's `../../fixtures/index`, its `ApiClient`, its data module:

```typescript
import { test, expect } from '../../fixtures/index';
import { USERS } from '../../data/testData';

test('should return 200 and User exists for valid credentials @smoke @regression @critical',
  async ({ apiClient }) => {                                          // ← injected fixture, no `new`
    const body = await apiClient.verifyLogin(USERS.existing.email, USERS.existing.password); // ← real ApiClient method
    expect(body.responseCode).toBe(200);
    expect(body.message).toBe('User exists!');
  });
```

**andrewbayd (realworld)** — flat POMs, **no fixtures**, kebab-case files, `new`-instantiation, plain `@playwright/test` import:

```typescript
import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home-page';
import { LoginPage } from '../pages/login-page';
import testdata from './testdata';

test.describe('Login', () => {
  test('should sign in with valid credentials and show Your Feed @smoke @regression', async ({ page }) => {
    const loginPage = new LoginPage(page);          // ← instantiation, page injected
    const homePage = new HomePage(page);

    await loginPage.goto();
    await loginPage.login(testdata.email, testdata.password);

    const isLoggedIn = await homePage.userIsLoggedIn();   // ← the project's own method name
    expect(isLoggedIn, 'user should be logged in after valid login').toBe(true);
  });
});
```

Opposite conventions — `new` vs injection, `@playwright/test` vs a custom fixtures module,
raw assertions vs an ApiClient — produced from the **same engine**, because each picked up its
own project's detected conventions.

---

## What the demo also caught (real-world hardening)

Running on the 5-year-old and 2.5-year-old projects surfaced real bugs that a synthetic demo
never would:

- **`export abstract class BasePage`** wasn't recognised by the class detector, so the saucedemo
  hierarchy was mis-rooted ([fixed in #101](https://github.com/bogdanid87-hub/qa-mcp-automation/pull/101)).
- **Fixture-injection bias on a no-fixtures project** — for andrewbayd the model first emitted
  `async ({ loginPage, homePage })` + an import from a fixtures module that doesn't exist, despite
  the detected `instantiation` convention. Prompt wording alone didn't fix it, so a deterministic
  post-generation transform now rewrites it back to `new`-instantiation
  ([fixed in #103](https://github.com/bogdanid87-hub/qa-mcp-automation/pull/103)) — the same
  detect-and-enforce-after-generation approach used for the inverse rewrite.

That's the point of testing on unfamiliar real codebases: it hardens the engine against the
messiness of the real world, not a curated happy path.

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
