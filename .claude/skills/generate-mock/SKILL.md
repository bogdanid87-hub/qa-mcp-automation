---
name: generate-mock
description: Generates a Playwright page.route() network mock (generate_mock MCP tool / npm run generate_mock) — fixture or inline scope, for third-party APIs, deterministic data, or error/loading states. Load when mocking a network request in a test.
---

# generate_mock

Generates a `page.route()` network mock — intercepts a URL pattern and returns a
controlled response without hitting the real server. Use for: mocking third-party
APIs (Stripe, Twilio, SendGrid) so they don't run in CI, deterministic test data,
error states (500, timeout, decline), or loading states (delayed responses).

## Usage

```
Generate a mock for the Stripe payments API that returns a payment_intent success.
Call it stripeSuccess. Intercept https://api.stripe.com/**.
```

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

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | yes | Mock name, e.g. `stripeSuccess`, `productSearch` |
| `urlPattern` | yes | URL pattern to intercept, e.g. `**/api/products` |
| `method` | no | `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`*` (default `*`) |
| `status` | no | HTTP status code (default 200) |
| `responseBody` | yes | Response described in plain English or pasted JSON |
| `scope` | no | `fixture` (shared file, default) or `inline` (one test) |
| `notes` | no | Extra context, e.g. "simulates a Stripe card_declined decline" |

## Output: fixture scope

Writes `fixtures/mocks/<name>.ts` with `mock<Name>(page)` and `unmock<Name>(page)`:

```typescript
export async function mockProductSearch(page: Page): Promise<void> {
  await page.route('**/api/products', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ products: [{ id: 1, name: 'Blue Top', price: 500 }] }),
    });
  });
}
```

```typescript
import { mockProductSearch } from '../fixtures/mocks/productSearch';

test('should show search results', async ({ page }) => {
  await mockProductSearch(page);
  await page.goto('/products');
});
```

## Output: inline scope

A snippet pasted directly inside a `test()` body — no separate file, same
`page.route()`/`route.fulfill()` shape.

## Notes

- `unmock<Name>()` companions are always generated for fixture scope — call to
  restore the real endpoint mid-test (e.g. testing error recovery).
- Use `fixture` when shared across tests, `inline` for one-off scenarios.
- For network errors (connection refused, timeout) rather than HTTP errors,
  describe this in `notes` — Claude uses `route.abort()` instead of
  `route.fulfill()`.
- Mock files live in `fixtures/mocks/` — import like any other fixture helper.

Full guide: [docs/generate-mock.md](../../../docs/generate-mock.md)
