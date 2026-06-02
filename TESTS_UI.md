# Test Cases

**Total: 7 tests**

---

## tests/ui/search.spec.ts

### Product Search

| # | Test |
|---|------|
| 1 | should search for a product and verify results match the API |

---

## tests/ui/subscription.spec.ts

### Subscription

| # | Test |
|---|------|
| 1 | should subscribe via the footer subscription form on the home page |
| 2 | should show an error when subscribing with an invalid email format |

---

## tests/ui/cart.spec.ts

### Cart

| # | Test |
|---|------|
| 1 | should add two products to cart and verify prices, quantity and total |
| 2 | should show empty cart when no products have been added |
| 3 | should remove a product from the cart and update the cart |

---

## tests/ui/contact.spec.ts

### Contact Us Form

| # | Test |
|---|------|
| 1 | should submit the contact form and show success message |

---

## ⚠️ Application Bugs

> These tests are correct — the application has a defect. Do not modify them.

| Risk | Spec | Describe | Test | Root cause | Actual behaviour |
|------|------|----------|------|------------|-----------------|
| critical | tests/ui/cart.spec.ts | Place Order: Add Products in Cart | should update total correctly when product quantity is changed in cart | The automationexercise.com cart page does not have an editable quantity input field (`.cart_quantity input`). The cart quantity is displayed as a static button/text element, not an `<input>` element. The locator `.cart_quantity input` never resolves because no such input exists in the DOM. | The cart page renders quantity as a read-only button element (`.cart_quantity button`) rather than an editable `<input>`. There is no inline quantity editor on the cart page — the site does not support updating quantity directly from the cart view. The `setQuantity` method times out waiting for an input element that does not exist. |
| low | tests/ui/subscription.spec.ts | Subscription | should reject duplicate email subscriptions | The test asserts that subscribing with the same email twice should not show a success message on the second attempt. However, the screenshot confirms that the application does show 'You have been successfully subscribed!' for the duplicate email — the site accepts duplicate subscriptions without any error or rejection. | automationexercise.com accepts duplicate email subscriptions silently. When the same email is submitted a second time, the site responds with the same 'You have been successfully subscribed!' success message as the first submission, rather than rejecting or warning about the duplicate. |
