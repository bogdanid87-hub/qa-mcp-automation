# Showcase — one engine, three very different real projects

**What this is.** `qa-mcp-engine` generates [Playwright](https://playwright.dev) tests for a
website automatically. You run it inside [Claude Code](https://claude.com/claude-code) and ask,
in plain English, for the test you want; it reads your existing test suite and writes new tests
that match it.

**Why "match it" is the hard part.** A generic AI test generator writes code in *its* own
style — foreign imports, the wrong folder, a different way of wiring page objects — and a
reviewer bounces it. This engine instead detects how *your* project already writes tests and
produces code in that same style, so the result drops into a pull request without looking out
of place. This page proves that on three real, **independently-authored** open-source projects
with deliberately different conventions — including one untouched for **five years**. Nothing
was adapted to suit the engine; the engine adapted to each of them.

> **A few terms used throughout.** A **POM** (Page Object Model) is a class that wraps one page
> and exposes methods like `login()` so tests don't deal in raw selectors. A test gets its POM
> in one of two styles: **instantiation** — `const loginPage = new LoginPage(page)` written
> inside the test — or **fixture-injection** — the POM is wired up once, centrally, and handed
> to the test as a ready-made argument: `async ({ loginPage }) => …`. A project picks one style
> and sticks to it, and matching that choice is exactly what the engine has to get right. The
> tools below (`generate_test`, `analyze_coverage`, …) are run by asking for them in Claude
> Code — they're exposed over [MCP](https://modelcontextprotocol.io).

Every spec and tool output below is a real captured run — two generated tests per project,
then five more of the engine's tools exercised end to end.

## The three projects

| Project | Age | Target site | House style |
|---|---|---|---|
| [ecureuill/saucedemo-playwright](https://github.com/ecureuill/saucedemo-playwright) | ~2.5 yrs | saucedemo.com | POMs in **`tests/pages/`**, `abstract class BasePage`, **`new`-instantiation**, no fixtures, JSON data files |
| [automationexercise-playwright](https://github.com/bogdanid87-hub/automationexercise-playwright) | current | automationexercise.com | `pages/` + `fixtures/index.ts`, **collapsed** hierarchy, **fixture-injection**, an **`ApiClient`** abstraction, `data/testData.ts` |
| [andrewbayd/playwright-page-object](https://github.com/andrewbayd/playwright-page-object) | **~5 yrs** | angular.realworld.io | flat POMs (no base class), **no fixtures**, `new`-instantiation, kebab-case files |

Three different sites, three different layouts, three different test-authoring styles.

---

## Step 1 — `learn_conventions` reads each project (free — no AI calls)

Run against each project untouched, the detector reports each project's actual conventions:

| What it detected | ecureuill (saucedemo) | AutomationExercise | andrewbayd (realworld) |
|---|---|---|---|
| POM directory | **`tests/pages`** (non-standard) | `pages` | `pages` |
| Base / hierarchy | `BasePage`, collapsed, 7 pages | `BasePage`, collapsed, 1 intermediate, 14 pages, 1 component | `HomePage`, flat, 4 pages |
| Fixtures | none | **16 injected** | none |
| POM consumption | **instantiation** | **fixture-injection** | **instantiation** |
| API style | none | **mixed (ApiClient)** | none |
| Runner projects | setup / e2e / visual / UI | chromium / api | Chrome / Firefox / WebKit |

Whatever it finds — including a non-standard POM folder like `tests/pages` — is saved as that
project's config and fed into every later step, so generation follows the project's real layout
instead of a one-size-fits-all default.

---

## Step 2 — the *same two tests*, three house styles

To make the difference visible, every project is asked for the **same two tests** — a valid
login, then a rejected invalid login. The scenario is held constant; only the house style
changes. Watch the same test come out three different ways.

### Test 1 — log in with valid credentials

**saucedemo** — instantiation (`new`), `@playwright/test`, POMs new'd up in a `beforeEach`:

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

**AutomationExercise** — fixture-injection: the `loginPage` is **handed in as an argument**
(no `new`), `test` imported from the project's own fixtures module, data from `testData.ts`:

```typescript
import { test, expect } from '../../fixtures';
import { USERS } from '../../data/testData';

test.describe('Login', () => {
  test('should log in with valid credentials and show logged-in username @smoke @regression', async ({ loginPage }) => {
    await loginPage.goto();                                  // ← injected fixture, no `new`
    await loginPage.loginPageLoaded();
    await loginPage.login(USERS.existing.email, USERS.existing.password);
    await expect(loginPage.loggedInAsText).toBeVisible();
  });
});
```

**andrewbayd** — instantiation (`new`), `@playwright/test`, flat kebab-case POM files:

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

### Test 2 — reject invalid credentials

Same test again, three styles — and each one found that project's *real* error element /
helper on its own:

**saucedemo** — instantiation, asserts saucedemo's own `.error-message-container`:

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Login', () => {
  test('should show error message for invalid username and password @regression @negative', async ({ page }) => {
    const loginPage = new LoginPage(page);                  // ← instantiation
    await loginPage.goto();
    await loginPage.page.locator('#user-name').fill('invalid_user');
    await loginPage.page.locator('#password').fill('wrong_password');
    await loginPage.page.locator('#login-button').click();

    await expect(loginPage.page.locator('.error-message-container')).toBeVisible();
  });
});
```

**AutomationExercise** — fixture-injection again, reusing the POM's `expectLoginError()` helper:

```typescript
import { test, expect } from '../../fixtures';

test.describe('Login', () => {
  test('should show error message when logging in with invalid credentials @regression @negative', async ({ loginPage }) => {
    await loginPage.goto();                                  // ← injected fixture, no `new`
    await loginPage.login('invalid_user@example.com', 'wrongpassword123');
    await loginPage.expectLoginError();
  });
});
```

**andrewbayd** — instantiation, asserting the live RealWorld error copy verbatim:

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login-page';

test.describe('Login', () => {
  test('should show error message when signing in with invalid credentials @regression @negative', async ({ page }) => {
    const loginPage = new LoginPage(page);                  // ← instantiation
    await loginPage.login('invalid@example.com', 'wrongpassword123');
    await loginPage.verifyErrorMessage('That email and password combination is invalid.');
  });
});
```

Same two tests, three codebases. The only thing that changed is the style the engine wrote in:
**instantiation vs fixture-injection**, `@playwright/test` vs a custom fixtures module, each
project's own error helper and the real error text it discovered on that site — all from one
engine, because each run followed the conventions detected in Step 1.

---

## Step 3 — the rest of the workflow (not just generation)

`generate_test` is one of fifteen tools. The QA loop — measuring coverage, mocking
third-party calls, standing up auth, and repairing failures — is automated too. Every block
below is a real captured run.

### `status` — suite health at a glance (free — no AI calls)

```
📊 QA Suite Status
  Registries:
    TESTS_UI.md      13 passing    1 broken    1 app bug
    TESTS_API.md     23 passing    0 broken    0 app bugs
    TESTS_VISUAL.md   4 passing    0 broken    0 app bugs
    Total            40 passing    1 broken    1 app bug

  ⚠️  Bottom line: 3 things could use attention:
  • 1 test is broken — run `npm run fix` to investigate.
  • 1 test found an app bug, not a test bug — review and report it.
  • 4 tests aren't tagged yet — run `npm run tag_tests`.
```

### `analyze_coverage` — finds the gaps in an existing spec

Pointed at a single happy-path `contact.spec.ts`, it reasons about *which* untested paths
matter most — separating **priority** (urgency to write) from **risk** (feature criticality):

```
✅ Coverage analysis complete — 5 gaps found  (0 critical · 0 high · 1 medium · 4 low)

Priority: Medium (1)
  should-submit-contact-form-without-file-attachment-and-show-success
  ℹ️ The no-attachment path is the dominant real-world usage. The only existing test always
     attaches a file, so a regression that breaks plain submission would be completely
     invisible to the suite.
```

It spotted that the *majority* user path (submitting without a file) was the biggest blind
spot — not just "add more asserts."

### `generate_mock` — a network mock from one request

Asked (in Claude Code) to mock `https://api.stripe.com/v1/charges**` returning a succeeded
charge, it writes a ready-to-use route fixture:

```typescript
// fixtures/mocks/paymentGateway.ts
export async function mockPaymentGateway(page: Page): Promise<void> {
  await page.route('https://api.stripe.com/v1/charges**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'ch_3Nq', status: 'succeeded', amount: 2500, currency: 'usd' }),
    });
  });
}
export async function unmockPaymentGateway(page: Page): Promise<void> {
  await page.unroute('https://api.stripe.com/v1/charges**');
}
```

### `generate_auth_fixture` — auto-detects the login form, wires the fixture

Run against saucedemo's live login page (no selectors supplied), it **inspected the DOM and
found the fields itself**, then wired a setup task + a `loggedInPage` fixture:

```
**Auto-detected login fields** (confirm, or re-run with explicit selectors):
  - email/username → #user-name
  - password       → #password
  - submit         → #login-button

**Files updated:**
  - tests/global.setup.ts — new setup task added
  - fixtures/index.ts — loggedInPage fixture added
  - .gitignore — test-data/.auth/loggedIn.json excluded
```

### `investigate_and_fix` — tells you when it's *your app* that's broken, not the test

The valuable thing here isn't patching selectors — it's refusing to fake a green when the
test is right and the application is wrong. Run against the live automationexercise.com suite,
the engine hit a failing product-search test, investigated the API responses and the DOM, and
concluded the **site itself** was defective — then wrote that verdict into the spec instead of
touching the assertions to make it pass:

```
/* ⚠️  APP BUG — This test is correct; the application under test has a defect.
 * Expected: searching 'top' should only return products whose name contains 'top'.
 * Actual:   the site's search endpoint matches across category/description too, so
 *           non-matching products (e.g. 'Little Girls Mr. Panda Shirt') are returned.
 * Do NOT change this test — it documents a real bug. Fix the application instead. */
```

That annotation is committed in
[`tests/ui/search.spec.ts`](../../tests/ui/search.spec.ts) — a real defect on a real public
site, caught and correctly **attributed to the app** by the engine rather than silently
mutated away. (When the failure genuinely is the test — a drifted selector, a renamed field —
the same tool repairs the spec and records a reusable lesson so the mistake doesn't recur.)

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
