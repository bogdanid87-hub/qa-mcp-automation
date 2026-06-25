# Coverage Analysis Report
Generated: 2026-06-03  |  Scope: tests/ui/subscription.spec.ts

---

## Summary

The subscription spec has solid foundational coverage: valid subscription on home and cart pages, invalid email format, empty email on cart, and a documented duplicate-email bug test. The most notable gaps are the missing empty-email validation test on the home page (a symmetric counterpart to the cart test that exists) and the absence of any subscription test from pages other than home and cart. Overall coverage quality is moderate — happy paths and one negative case are well covered, but edge cases and multi-page parity are missing.

---

## Coverage state

**Well covered:**
- Valid subscription via footer on home page
- Valid subscription via footer on cart page
- Invalid email format rejected by native browser validation (home page)
- Empty email submission on cart page triggers native validation and suppresses success message
- Duplicate subscription documented as a known app bug

**Partially covered:**
- Empty/invalid email validation — covered on cart page but not on home page
- Page-specific subscription coverage — only home and cart are tested; other pages with a footer subscription form are untested

---

## Gaps found — 4 total by priority (0 critical · 0 high · 1 medium · 3 low)

> **Priority** = urgency to write the test. **Risk** = intrinsic feature criticality.
> These differ when the dominant user path is untested or coverage is zero for a flow.

### Priority: Medium (1)

**should-show-native-validation-for-empty-email-on-home-page** — `tests/ui/subscription.spec.ts`  [direct]
*The empty-email test exists for the cart page but not for the home page, leaving an asymmetric blind spot — a regression in the home-page subscription form's empty-email guard would be invisible.*

Navigate to the home page, scroll to the footer subscription section, leave the email input empty, and click the subscribe button. Assert that the success message does NOT appear, and that the native browser validity API marks the input as invalid (same pattern as the cart test, UI Subscription #4).

### Priority: Low (3)

**should-subscribe-via-footer-on-product-detail-page** — `tests/ui/subscription.spec.ts`  [direct | risk: medium]
*The product detail page also renders the footer subscription form, and a rendering or wiring defect specific to that page template would not be caught by existing tests.*
> ℹ️ Lower priority than the empty-email gap because happy-path subscription is already covered on two pages; this is an additional surface-area check rather than a dominant path.

Navigate to any product detail page (e.g. via the products list), scroll to the footer, enter a valid random email, click subscribe, and assert that the success message '#success-subscribe' becomes visible.

**should-subscribe-via-footer-on-products-list-page** — `tests/ui/subscription.spec.ts`  [direct | risk: medium]
*The products list page renders the shared footer; a page-specific JavaScript or rendering error that breaks subscription only on that template would not be caught.*
> ℹ️ Same rationale as the product detail gap — incremental surface-area coverage; not urgent given existing two-page coverage.

Navigate to '/products', scroll to the footer subscription widget, fill in a valid random email, click the subscribe button, and assert that '#success-subscribe' is visible with the expected success text.

**should-show-native-validation-for-invalid-email-on-cart-page** — `tests/ui/subscription.spec.ts`  [suggested | risk: medium]
*The malformed-email rejection test covers the home page but not the cart page, so a cart-specific regression in email format validation would go undetected.*
> ℹ️ The invalid-email format test exists only on the home page (UI Subscription #2); adding the same check for the cart page provides symmetric coverage but is low urgency given the shared implementation.

Navigate to '/view_cart', scroll to the footer, enter a malformed email string (e.g. 'notanemail'), click subscribe, assert the success message does NOT appear, and verify via the validity API that the input is marked invalid — mirroring UI Subscription #2.

---

## Recommendations

1. Add the empty-email validation test for the home page (medium priority) to close the asymmetry with the existing cart-page test and ensure regressions on the dominant subscription surface are visible. 2. Consider whether additional page templates (products list, product detail) are important enough to warrant surface-area smoke tests for the subscription widget — these are low priority but cheap to implement given the existing cart-page pattern. 3. No action needed on duplicate-subscription behaviour; it is already documented as a known app bug with a test.fail() guard.
