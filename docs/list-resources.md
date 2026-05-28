# list\_resources

Lists all existing page objects, fixtures, and spec files in the project. Always
check this before generating a new test to understand what already exists and avoid
duplicating code.

---

## From Claude Code

```
List existing resources
What page objects already exist?
```

No parameters.

---

## Example output

```
### Pages (POMs)
  - pages/BasePage.ts
  - pages/CartPage.ts
  - pages/CheckoutPage.ts
  - pages/ContactUsPage.ts
  - pages/HomePage.ts
  - pages/LoginPage.ts
  - pages/ProductsPage.ts

### Fixtures
  - fixtures/index.ts

### Tests
  - tests/api/products.spec.ts
  - tests/e2e/place-order.spec.ts
  - tests/ui/cart.spec.ts
  - tests/ui/contact.spec.ts
  - tests/ui/search.spec.ts
  - tests/ui/subscription.spec.ts
```

---

## When to use it

**Before `generate_test`** — check whether a POM for the page already exists. If
`pages/LoginPage.ts` is listed, `generate_test` will add methods to it rather than
creating a new file. Knowing this helps you write a more accurate description.

**Before `generate_pom`** — check whether a POM already exists and has been
promoted (has methods). `generate_pom` skips promoted files, so if `LoginPage.ts`
is already there you'd use `generate_test` to extend it instead.

**When investigating a failure** — quickly see which files are in the project without
opening the file explorer.
