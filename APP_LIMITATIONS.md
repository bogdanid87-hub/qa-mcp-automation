# App Limitations

Known features that are **not implemented** on the app under test.

The test generator, PRD analyser, and coverage analyser read this file to avoid
suggesting tests for features that don't exist. Edit directly — this file is never
auto-overwritten.

Use this for genuine missing features. For features that *should* work but are
broken, use the test registry (`test.fail()` + app_bug annotation) instead.

---

## Navigation

- **No cart item counter in nav bar** — the "Cart" nav link (`a[href="/view_cart"]`)
  is plain text with no badge, counter, or quantity indicator. Do not generate tests
  that assert on a cart nav counter element.
