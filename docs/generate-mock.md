# generate\_mock

Generates a Playwright `page.route()` network mock — intercepts a URL pattern and
returns a controlled response without hitting the real server.

Use this to:
- Mock third-party APIs (Stripe, Twilio, SendGrid) so they don't run in CI
- Create deterministic test data (always return the same product list)
- Test error states (simulate a 500, a timeout, or a payment decline)
- Test loading states (delay responses to verify spinners and skeletons)

---

## Usage

### From Claude Code

```
Generate a mock for the Stripe payments API that returns a payment_intent success.
Call it stripeSuccess. Intercept https://api.stripe.com/**.

Generate a mock for the product search endpoint that returns two specific products.
Intercept **/api/products with a GET. Call it productSearch.
```

### From the terminal

```bash
# Fixture mock (reusable across tests)
npm run generate_mock -- \
  --name productSearch \
  --url '**/api/products' \
  --method GET \
  --response '{"products": [{"id": 1, "name": "Blue Top", "price": 500}]}' \
  --notes "Returns one deterministic product for search result tests"

# Inline mock (one-off snippet inside a test)
npm run generate_mock -- \
  --name stripeError \
  --url 'https://api.stripe.com/**' \
  --status 402 \
  --response "payment required, decline code card_declined" \
  --scope inline
```

Run `npm run generate_mock -- --help` for all options.

---

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | yes | Mock name, e.g. `stripeSuccess`, `productSearch` |
| `urlPattern` | yes | URL pattern to intercept, e.g. `**/api/products` or `https://api.stripe.com/**` |
| `method` | no | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `*` (default: `*`) |
| `status` | no | HTTP status code (default: 200) |
| `responseBody` | yes | Describe the response in plain English or paste JSON |
| `scope` | no | `fixture` — shared file (default); `inline` — snippet for one test |
| `notes` | no | Extra context, e.g. "simulates a Stripe card_declined decline" |

---

## Output: fixture scope

A file is written to `fixtures/mocks/<name>.ts`:

```typescript
// fixtures/mocks/productSearch.ts
import { Page } from '@playwright/test';

export async function mockProductSearch(page: Page): Promise<void> {
  await page.route('**/api/products', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        products: [{ id: 1, name: 'Blue Top', price: 500 }]
      }),
    });
  });
}

export async function unmockProductSearch(page: Page): Promise<void> {
  await page.unroute('**/api/products');
}
```

Use it in a test:

```typescript
import { mockProductSearch } from '../fixtures/mocks/productSearch';

test('should show search results', async ({ page }) => {
  await mockProductSearch(page);
  await page.goto('/products');
  // page now sees controlled data, not the live API
});
```

---

## Output: inline scope

A code snippet to paste directly inside a `test()` body — no separate file:

```typescript
// Inside your test body:
await page.route('https://api.stripe.com/**', async route => {
  await route.fulfill({
    status: 402,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'card_declined' } }),
  });
});

// ... rest of test
```

---

## Notes

- `unmock<Name>()` companion functions are always generated — call them to restore
  the real endpoint mid-test (e.g. to test that error recovery sends the real request)
- Use `scope: fixture` when the mock is shared across multiple tests; use `scope: inline`
  for one-off scenarios
- For network errors (connection refused, timeout) rather than HTTP errors, describe
  this in `notes` — Claude will use `route.abort()` instead of `route.fulfill()`
- Mock files live in `fixtures/mocks/` — import them like any other fixture helper
