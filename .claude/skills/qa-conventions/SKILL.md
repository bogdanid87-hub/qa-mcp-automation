---
name: qa-conventions
description: Project conventions for qa-mcp-automation's Playwright suite — POM class hierarchy, locator priority and pitfalls, test file/folder naming, and the trackCleanup fixture. Load when creating or editing files under pages/, tests/, or fixtures/.
---

# QA Conventions

For the full rule set the MCP tool uses when *generating* tests, see
`src/prompts/system.ts` (CORE_RULES) and `src/prompts/learned-rules.md` (also
loaded by [learned-rules-loader](../learned-rules-loader/SKILL.md)). This skill is
the quick reference for editing `pages/`, `tests/`, and `fixtures/` directly.

## POM hierarchy

Three-level inheritance chain:

```
BasePage          — navigate(), popup handling only
  └── SitePage    — nav bar, footer subscription, loggedInAs (all site pages)
        ├── HomePage, CartPage, LoginPage, CheckoutPage, AccountPage, ContactUsPage
        └── ProductListPage  — product card grid, cart modal (listing pages)
              └── ProductsPage  — search box, headings (specific to /products)
```

| Class | Use when |
|---|---|
| `SitePage` | Any full page of the site — has the nav bar and footer |
| `ProductListPage` | Pages with a product card grid + sidebar: `/products`, `/category_products/:id`, `/brand_products/:slug` |
| `BasePage` | Only for pages with no site nav/footer (isolated forms, modals) |

**Locators already owned by parents — never re-declare in subclasses:**
- `SitePage`: `logo`, `navContactUs`, `navProducts`, `loggedInAs`, `footer`, `subscriptionHeading`, `subscribeEmailInput`, `subscribeBtn`, `subscribeSuccessMessage`
- `ProductListPage`: `productCards`, `cartModal`, `continueShoppingBtn`, `viewCartLink`

- POM classes: **named exports only** — `export class LoginPage`, never `export default class`
- All POM parent imports are named: `import { SitePage } from './SitePage'`
- If a POM for the target page already exists in `pages/`, add to it — never create
  a second class for the same page.

## Locators

Priority order (strict):
1. `[data-qa="..."]`
2. `getByRole(...)`
3. `getByLabel(...)`
4. `getByPlaceholder(...)`
5. `getByText(...)`
6. `#id`

Rules:
- Only use a strategy if the attribute actually exists in the DOM — inspect the
  live page first, never assume.
- Scope class selectors by element type: `h1.title` not `.title`.
- Never use `.first()`/`.last()` as the only disambiguator — scope to a unique
  ancestor instead.
- A compound class can still collide across page regions (Bootstrap reuses
  `.active`, `.alert`, `.alert-success`, `.item` everywhere). Before using ANY
  class-based locator, consider whether the same combination appears elsewhere on
  the page — scope to a unique container, e.g. `#review-form .alert-success.alert`.
- Never assert `toBeVisible()` on Bootstrap carousel `.item` elements (Rule 004) —
  hidden slides exist in the DOM and `.item` matches all of them.

## Navigation

- `waitForLoadState`: use `'domcontentloaded'` — `'load'` times out due to
  third-party analytics/ad scripts on automationexercise.com.
- Direct navigation (`page.goto('/path')`) unless the test explicitly requires
  clicking a link.

## Test organisation

```
tests/
  global.setup.ts       — saves guest browser state before tests run
  ui/                    — single-feature browser tests   → TESTS_UI.md
  e2e/                   — full user journeys              → TESTS_E2E.md
  api/                   — direct HTTP tests (no browser)  → TESTS_API.md
  visual/                — visual regression tests
pages/                   — Page Object Models (one class per page)
fixtures/index.ts        — custom test + expect (ad-blocking + popup handling)
```

- Spec imports: `import { test, expect } from '../../fixtures'` (two levels up
  from `ui/` or `e2e/`)
- `test.describe()` = broad feature area ("Place Order", "Cart") — never the
  scenario
- `test()` = specific scenario ("should register during checkout and place an
  order")
- The spec file is determined by the PRIMARY page where the main user action
  happens — not by where the test ends or what it asserts on. If a spec file
  already covers that feature area, add to it.

## trackCleanup fixture

Tests that create data via the API (accounts, cart items, reviews, subscriptions)
register cleanup immediately after creation:

```typescript
test('should ...', async ({ request, trackCleanup }) => {
  const email = randomEmail();
  await request.post('/api/createAccount', { form: { email, /* ... */ } });
  trackCleanup(() => request.delete('/api/deleteAccount', { form: { email } }));
  // ... rest of test — cleanup runs even if these fail
});
```

Fixture teardown runs every registered callback in reverse order after the test
finishes, pass or fail, each wrapped in try/catch.

## Files that are auto-managed — do not edit manually

| File | Managed by |
|------|-----------|
| `TESTS_UI.md` | `generate_test`, `npm run sync_registry`, `npm run update_registry` |
| `TESTS_E2E.md` | same — `tests/e2e/` only |
| `TESTS_API.md` | same — `tests/api/` only |
| `src/prompts/learned-rules.md` | `investigate_and_fix` (auto-appends after every fix) |
| `test-data/.auth/guest.json` | `global.setup.ts` (Playwright setup) |
