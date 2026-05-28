# Test Cases

**Total: 8 tests** | **Latest:** #8 — Place Order: Add Products in Cart › should remove a product from the cart and update the cart

---

## tests/contactUs.spec.ts

### Contact Us Form

| # | Test |
|---|------|
| 1 | should submit the contact form and show success message |

---

## tests/searchProduct.spec.ts

### Product Search

| # | Test |
|---|------|
| 2 | should search for a product and verify results match the API |

---

## tests/subscription.spec.ts

### Subscription

| # | Test |
|---|------|
| 3 | should subscribe via the footer subscription form on the home page |
| 4 | should show an error when subscribing with an invalid email format |
| 5 | should accept duplicate email subscriptions and show success each time |

---

## tests/cart.spec.ts

### Place Order: Add Products in Cart

| # | Test |
|---|------|
| 6 | should add two products to cart and verify prices, quantity and total |
| 7 | should show empty cart when no products have been added |
| 8 | should remove a product from the cart and update the cart ← latest |

---

## ⚠️ Application Bugs

> These tests are correct — the application has a defect. Do not modify them.

| Spec | Describe | Test | Root cause | Actual behaviour |
|------|----------|------|------------|-----------------|
| tests/cart.spec.ts | Place Order: Add Products in Cart | should update total correctly when product quantity is changed in cart | The automationexercise.com cart page does not have an editable quantity input field (`.cart_quantity input`). The cart quantity is displayed as a static button/text element, not an `<input>` element. The locator `.cart_quantity input` never resolves because no such input exists in the DOM. | The cart page renders quantity as a read-only button element (`.cart_quantity button`) rather than an editable `<input>`. There is no inline quantity editor on the cart page — the site does not support updating quantity directly from the cart view. The `setQuantity` method times out waiting for an input element that does not exist. |

---

## ❌ Broken Tests

> Fix manually or run: `npm run fix -- --pattern <spec>`

| Spec | Describe | Test | Root cause |
|------|----------|------|------------|
| tests/placeOrderRegisterWhileCheckout.spec.ts | Place Order: Register while Checkout | should register during checkout, place order, and delete account | The test calls `cartPage.verifyLoaded()` but the `CartPage` class does not have a `verifyLoaded()` method defined. The method exists on other page objects (like `ProductsPage`) but was never added to `CartPage`. |
| tests/placeOrderRegisterWhileCheckout.spec.ts |  | tests/placeOrderRegisterWhileCheckout.spec.ts | BasePage.ts exports the class as a named export (`export class BasePage`) but CheckoutPage.ts imports it as a default import (`import BasePage from './BasePage'`). This import resolves to `undefined`, causing the 'Class extends value undefined' error. |
