---
name: list-resources
description: Lists existing POMs, fixtures, and spec files in qa-mcp-automation (list_resources MCP tool). Load before generating a new test or POM to check what already exists and avoid duplicating code.
---

# list_resources

Lists all existing page objects, fixtures, and spec files. Always check this
before generating a new test to understand what already exists and avoid
duplicating code — see [qa-workflow's look-ahead section](../qa-workflow/SKILL.md#look-ahead-check-before-you-add-applies-to-your-own-direct-edits-too).

## Usage

MCP only — no parameters:

```
List existing resources
What page objects already exist?
```

## Example output

```
### Pages (POMs)
  - pages/BasePage.ts
  - pages/CartPage.ts
  - pages/LoginPage.ts
  - pages/ProductsPage.ts

### Fixtures
  - fixtures/index.ts

### Tests
  - tests/api/products.spec.ts
  - tests/e2e/place-order.spec.ts
  - tests/ui/cart.spec.ts
```

## When to use it

- **Before `generate_test`** — if `pages/LoginPage.ts` is listed, `generate_test`
  adds methods to it rather than creating a new file; knowing this up front helps
  write a more accurate description.
- **Before `generate_pom`** — `generate_pom` skips POMs that are already
  "promoted" (have methods); if the target page's POM already has methods, use
  `generate_test` to extend it instead.
- **When investigating a failure** — quickly see which files exist without
  opening the file explorer.

Full guide: [docs/list-resources.md](../../../docs/list-resources.md)
