# Test Cases

**Total: 12 tests**

---

## tests/ui/cart.spec.ts

### Cart

| # | Test |
|---|------|
| 1 | should add two products and verify names, unit prices, quantities, and row totals @smoke @regression @critical |
| 2 | should show empty cart when navigating directly to cart without adding products @regression |
| 3 | should show quantity 2 in a single row when the same product is added to the cart twice @regression @critical |
| 4 | should remove a product from the cart and show an empty cart @regression @critical |

---

## tests/ui/product-detail.spec.ts

### Product Detail

| # | Test |
|---|------|
| 1 | should add product to cart and verify it appears in cart @smoke @regression @critical |
| 2 | should submit a product review and show the thank you message @regression |
| 3 | should show quantity 3 and correct total in cart when quantity is changed before adding to cart @regression @critical |

---

## tests/ui/contact.spec.ts

### Contact Us

| # | Test |
|---|------|
| 1 | should submit contact form with file attachment and show success message @smoke @regression |

---

## tests/ui/subscription.spec.ts

### Newsletter Subscription

| # | Test |
|---|------|
| 1 | should subscribe successfully from home page footer @smoke @regression |
| 2 | should subscribe successfully from cart page footer without leaving the cart @regression |
| 3 | should reject invalid email format in the subscription form @regression |
| 4 | should prevent submission when email field is empty @regression |

---

## ⚠️ Application Bugs

> These tests are correct — the application has a defect. Do not modify them.

| Risk | Spec | Describe | Test | Root cause | Actual behaviour |
|------|------|----------|------|------------|-----------------|
| medium | tests/ui/search.spec.ts | Product Search | should display results matching search term and count matches the API @smoke @regression | The automationexercise.com search API returns products that do not match the search term. Searching for 'top' returns 'Little Girls Mr. Panda Shirt' (and likely other non-matching products), meaning the server-side search is not filtering strictly by product name containing the search term. | The site's search endpoint performs a loose/fuzzy match or searches across additional fields (e.g. category, description, tags) beyond just the product name. As a result, products whose names do not contain 'top' are included in the results. The UI and API both return the same set of results (so the count assertion passes), but the individual product names do not all contain the search term, exposing that the search is not name-only. |

---

## ❌ Broken Tests

> Fix manually or run: `npm run fix -- --pattern <spec>`

| Risk | Spec | Describe | Test | Root cause |
|------|------|----------|------|------------|
| medium | tests/ui/cart.spec.ts | Cart | should show checkout modal with register/login option when guest clicks Proceed To Checkout @smoke @regression @critical | Claude returned invalid JSON |
