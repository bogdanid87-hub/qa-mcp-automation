# App Knowledge Base

_Auto-generated — human-editable. Re-run `npm run generate_knowledge` to refresh._
_Last updated: 2026-06-03_

---

## Cart

**Risk level:** high
**App bugs:**
- Quantity field on cart page is a read-only `<button>` element (`.cart_quantity button`), not an `<input>`. Inline quantity editing from the cart view is not supported by the site; any test using `.cart_quantity input` will time out.
**Open gaps:** none
**Notes:** The site has no cart-side quantity editor — tests requiring quantity updates must drive that interaction from the product detail page before adding to cart, not from the cart view itself.

---

## Subscription

**Risk level:** medium
**App bugs:**
- Duplicate email subscriptions are silently accepted; the site returns the same `You have been successfully subscribed!` success message on repeat submissions rather than rejecting or warning the user.
**Open gaps:** none
**Notes:** Do not write tests asserting duplicate-subscription rejection — the site has no such guard; any such assertion will fail as a known site defect, not a product regression.

---

## Contact Us

**Risk level:** low
**App bugs:** none
**Open gaps:**
- `should-submit-contact-form-without-file-attachment` *(medium priority)* — happy path without a file attachment is entirely untested; a regression on the dominant user path would be invisible.
- `should-show-validation-errors-when-required-fields-are-empty` *(low priority)* — blank-form submission validation is untested.
- Three further low-priority validation/negative-path gaps identified in last coverage report (individual field validation, invalid email format, oversized attachment handling).
**Notes:** The only existing test always attaches a file, so coverage is skewed toward an atypical path; prioritise the no-attachment happy path before adding negative/validation cases.
