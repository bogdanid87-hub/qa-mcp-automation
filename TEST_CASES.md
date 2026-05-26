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

## ❌ Broken Tests

> Fix manually or run: `npm run fix -- --pattern <spec>`

| Spec | Describe | Test | Root cause |
|------|----------|------|------------|
| tests/cart.spec.ts | Place Order: Add Products in Cart | should update total correctly when product quantity is changed in cart | Failing but never recorded — run `npm run fix` to investigate. |
