---
name: generate-pom
description: Inspects live pages and generates a locator-only POM (generate_pom MCP tool), including live .count() locator validation. Run before generate_test on a page without a POM yet. Load when building/extending a POM or fixing a flagged locator.
---

# generate_pom

Inspects one or more live pages and generates a Page Object Model file containing
only `readonly Locator` property declarations — no methods. Run before
`generate_test` when working on a page that doesn't have a POM yet.

## Why locators-only first

When `generate_test` creates a POM and spec together, it invents locators and test
logic at the same time — a wrong locator means a failing test, an auto-fix run,
and wasted tokens. `generate_pom` separates locator discovery from method writing:

1. `generate_pom /login` — inspect the real DOM, write correct locators to
   `pages/LoginPage.ts`
2. `generate_test` — sees the existing POM, adds only the methods it needs

## Parent class selection

Same hierarchy as [qa-conventions](../qa-conventions/SKILL.md#pom-hierarchy):
`SitePage` for any full site page, `ProductListPage` for product-card-grid pages
(`/products`, `/category_products/:id`, `/brand_products/:slug`), `BasePage` only
for pages with no site nav/footer. Locators already owned by parent classes are
never re-declared.

This hierarchy and the "already owned" locators/methods are generated from
`mcp-qa.config.json`'s `pom` section plus the live `pages/<SiteClass>.ts` /
intermediate-class files — `ProductListPage`/`/products`/etc. are this project's
current values, not fixed in the prompt.

## Locator priority

Same order as [qa-conventions](../qa-conventions/SKILL.md#locators): `[data-qa]` →
`getByRole` → `getByLabel` → `getByPlaceholder` → `getByText` → `#id`.

## How it runs

Local LLM (`qwen2.5-coder:14b` via Ollama) by default — locator generation is
mechanical DOM-to-TypeScript mapping; falls back to Claude if Ollama isn't running.
Multiple URLs run in parallel (one call per URL).

**The model never writes the `.ts` file directly** — it returns a structured
`PomSpec` (`name`, `selectorType`, `value`/`roleName`), and `compilePom()`
(`src/templates/pom.ts`) renders it through a fixed template. An invalid response
is a generation failure for that page (local LLM falls back to Claude; if Claude's
response is also invalid, the page is skipped) — see
[docs/conventions.md](../../../docs/conventions.md#templated-pom-compile--srctemplatespomts).

## Site audit enrichment

If `workspace/site-audit-report.md` exists (from `audit_site`), the tool injects the page's
known IDs/form inputs as hints — pre-filtered, confirmed-present candidates instead
of raw DOM inference. Recommended for new projects:
`audit_site` → `generate_pom` per page → `generate_test`.

## Locator validation

After writing each POM, the tool visits the live page and counts how many elements
each `page.locator('...')` selector matches:

| Status | Count | Meaning |
|--------|-------|---------|
| ✅ reliable | = 1 | Selector uniquely identifies one element |
| ⚠️ ambiguous | > 1 | Selector is too broad — tighten it before use |
| ❌ broken | = 0 | Selector matches nothing on the live page |

`getByRole`/`getByLabel`/`getByText`/`getByPlaceholder` are semantic and not
re-validated. Only `page.locator()` CSS/XPath selectors are checked.

**If validation flags issues, fix the selector before running `generate_test`** — a
broken locator at the POM stage becomes a failing test at the spec stage. This is
the live, deterministic counterpart to
[generate-test](../generate-test/SKILL.md#locator-uniqueness)'s "compound class can
still collide" rule — a `.count() > 1` result here is exactly the Rule 002–005/024/025
failure mode caught before a spec is even written.

## Guard behaviour

`generate_pom` will not overwrite a POM file that already has `async` methods
("promoted" by `generate_test`) — it skips with a message. A locators-only file is
updated in place (new locators added, existing ones kept).

## Usage

MCP only — no terminal CLI:

```
Generate a POM for the login page
Generate POMs for /login and /checkout
Generate a POM for /payment — name it PaymentPage
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `urls` | yes | Page paths to inspect, e.g. `["/login", "/checkout"]` |
| `page_name` | no | Class name override for a single URL, e.g. `"LoginPage"` |

## Workflow integration

```
New page, no POM:        generate_pom → fix flagged locators → generate_test
Complex flow (3+ pages): generate_pom on all pages in parallel → fix flags → generate_test
New project:              audit_site → generate_pom per page → generate_test
POM already has methods: generate_test extends it directly, pom step skipped
```

Full guide: [docs/generate-pom.md](../../../docs/generate-pom.md)
