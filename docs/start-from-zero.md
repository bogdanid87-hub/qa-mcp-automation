# Starting from Zero

This guide covers the complete workflow for setting up QA automation on a new site using
these tools — from first crawl to a passing test suite. Follow it in order.

---

## Prerequisites

Complete the setup steps in the [README](../README.md) first:
- Node.js 18+, Anthropic API key set in Keychain, Ollama running (optional but recommended)
- `npm install` and `npx playwright install chromium`

---

## Phase 1 — Understand the site

### 1.1 Run the full audit

```bash
npm run audit_site -- --url https://your-site.com
```

This produces two outputs in `workspace/`:
- `site-audit-report.md` — human-readable: page types, shared elements, POM hierarchy recommendation
- `site-audit-report.json` — machine-readable: auto-read by `generate_pom` as locator hints

And in `test-data/`:
- `constants.ts` — typed test data: products/items, categories, search terms, user fixture, payment card

**Read `workspace/site-audit-report.md` before proceeding.** It tells you:
- Which pages exist (and their URL patterns)
- Which elements are shared across all pages → belong in `SitePage` / `BasePage`
- Which intermediate classes might be worth creating (e.g. a product listing base)

### 1.2 Verify or update base classes

The audit identifies shared elements but doesn't write base classes for you — that's a deliberate
design decision. Review the "Universal elements" section and check that `SitePage` already covers
the shared nav, footer, and subscription form. If the site has elements the base classes don't
cover, add them by hand before generating any page-specific POMs.

### 1.3 Re-run data mode after setup to refresh constants

```bash
npm run audit_site -- --url https://your-site.com --mode data
```

Run this again after reviewing the site to ensure the constants file has all the product/item
IDs and search terms you expect. Re-running is safe — it merges new data without overwriting
`TEST_USER` or `PAYMENT`.

---

## Phase 2 — Generate Page Object Models

Generate a POM for each distinct page type identified in the audit, one URL at a time.
The tool inspects the live DOM, applies audit hints, writes the locators, and validates
each `page.locator()` selector before returning.

```bash
# From Claude Code chat — one or multiple pages at once:
generate_pom ["/login"]
generate_pom ["/products"]
generate_pom ["/product_details/1", "/view_cart", "/checkout"]
```

**After each generation, review the validation report:**
- ✅ count = 1 → reliable, use as-is
- ⚠️ count > 1 → selector is ambiguous, tighten it before generating tests
- ❌ count = 0 → selector doesn't match anything, fix before proceeding

Fix any flagged locators in the generated file, then move on.

### What you'll have after Phase 2

```
pages/
  LoginPage.ts        — locators validated, no methods yet
  ProductsPage.ts     — locators validated
  ProductDetailPage.ts
  CartPage.ts
  CheckoutPage.ts
  ...
```

---

## Phase 3 — Write test descriptions

Before generating any specs, write plain-English test descriptions in `workspace/my-test.txt`.
This is the single most important input to the tool — describe what to test, not how.

```
# spec_file: tests/ui/cart.spec.ts
# page_paths: /products, /view_cart
Add two different products to the cart and verify both appear with correct
names, prices, and totals.

---

# spec_file: tests/e2e/checkout.spec.ts
# page_paths: /products, /view_cart, /login, /checkout
Register a new account during checkout, place an order, and verify the
confirmation page. Delete the test account afterwards.
```

**Directives (optional but recommended):**

| Directive | Purpose |
|-----------|---------|
| `# spec_file:` | Target file — determines the spec file, never the test name |
| `# page_paths:` | URLs to inspect for accurate locators |
| `# test_name:` | Names the `test()` and `describe()` blocks |

Separate multiple tests with `---` on its own line. Batch mode generates all of them sequentially.

**Good descriptions:**
- State the user goal, not the implementation
- Mention what to verify, not which locator to use
- Include edge cases as separate entries (empty state, invalid input, duplicate)

---

## Phase 4 — Generate tests

### 4.1 Preview first (recommended)

Use `dry_run` to see the target spec path and proposed code before spending tokens:

```
generate_test dry_run: true
description: "Add two products to cart and verify totals"
page_paths: ["/products", "/view_cart"]
```

Check:
- Target spec is correct (`tests/ui/cart.spec.ts`, not something unexpected)
- No hardcoded product names — values are captured at runtime or imported from constants
- POM methods are used, not raw `page.locator()` calls
- Helpers are extracted for any shared multi-step flows

### 4.2 Run the batch

```bash
npm run generate -- --file workspace/my-test.txt
```

The tool processes each `---` separated block, generates POM methods, writes the spec, runs it,
and records passing tests in `TESTS_UI.md`. App bugs are annotated and never "fixed" by
changing the test — they're recorded as-is.

### 4.3 Fix any failures

```bash
npm run fix -- --pattern tests/ui/cart.spec.ts
```

The fix tool reads the Playwright screenshot and live DOM at point of failure, classifies the
root cause as a code bug or app bug, and either patches the test or annotates it. A lesson is
appended to `learned-rules.md` so the same issue doesn't recur.

---

## Phase 5 — Review and commit

```bash
npm test                # run the full suite (Chromium)
npm run status          # suite health at a glance
```

`npm run status` ends with a "Bottom line" — a plain-English summary of whether
anything needs attention, and which command to run if so.

Review `TESTS_UI.md` — every passing test is recorded with its risk level and spec location.
Review `workspace/APP_KNOWLEDGE.md` if `investigate_and_fix` ran — it records what it learned
about app-specific bugs and quirks.

Commit the generated files on a branch, open a PR, and merge after review.

---

## Phase 6 — Iterate

Once the initial suite is green:

1. **Add more tests** — add new descriptions to `workspace/my-test.txt` and re-run the batch
2. **Refresh test data** — `npm run audit_site -- --mode data` when the site catalogue changes
3. **Analyse coverage** — `npm run analyze_coverage` to see gaps; output goes to `workspace/`
4. **PRD-driven expansion** — `npm run analyze_prd -- --file workspace/prd.md` to turn feature
   requirements into a prioritised test backlog

---

## Comparison workflow (after regeneration)

If you archived a previous version of the suite to `.qa-archive/`, you can compare:

```bash
diff -r .qa-archive/pages pages/
diff -r .qa-archive/tests/ui tests/ui/
```

This shows exactly what changed between the hand-crafted originals and the freshly generated
output — useful for validating that the tool improvements produce measurably better results.

---

## Quick reference

| Goal | Command |
|------|---------|
| Full site audit + test data | `npm run audit_site -- --url https://site.com` |
| Refresh test data only | `npm run audit_site -- --mode data --url https://site.com` |
| Generate POM for a page | `generate_pom ["/page-path"]` (Claude Code chat) |
| Preview a test before writing | `generate_test dry_run: true` (Claude Code chat) |
| Generate from file (batch) | `npm run generate -- --file workspace/my-test.txt` |
| Run and fix failures | `npm run fix -- --pattern tests/ui/x.spec.ts` |
| Full suite | `npm test` |
| Suite health | `npm run status` |
| Coverage gaps | `npm run analyze_coverage` |
| PRD → test backlog | `npm run analyze_prd -- --file workspace/prd.md` |
