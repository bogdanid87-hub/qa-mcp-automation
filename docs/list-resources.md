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
  - tests/cart.spec.ts
  - tests/contactUs.spec.ts
  - tests/placeOrderRegisterWhileCheckout.spec.ts
  - tests/searchProduct.spec.ts
  - tests/subscription.spec.ts
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
