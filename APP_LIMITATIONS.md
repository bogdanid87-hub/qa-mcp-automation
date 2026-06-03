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

## API

- **HTTP transport status is always 200** — every endpoint returns HTTP 200 at the
  transport level regardless of outcome. Success and error codes are returned inside
  the JSON body as `responseCode` (e.g. 201 for account creation, 400/404/405 for
  errors). Do not suggest tests that assert `response.status()` to be anything other
  than 200. Always check the application-level code: `expect(body.responseCode).toBe(N)`.

- **No authentication required for most endpoints** — the API does not enforce
  session-based auth on read endpoints. Tests do not need to log in before calling
  GET endpoints such as `/api/productsList` or `/api/brandsList`.
