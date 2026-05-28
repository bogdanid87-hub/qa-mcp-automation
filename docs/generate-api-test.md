# generate\_api\_test

Generates a Playwright API test using the `request` fixture — no browser, no DOM,
no page objects. Uses the local LLM (Ollama) as the primary generator; falls back
to the Claude API automatically. Writes to `tests/api/` and records results in
`TEST_API.md`.

---

## When to use it

- Testing an HTTP endpoint directly (status code, response body, error handling)
- After running `npm run analyze_prd -- --url <api-docs-page>` — the generated `prd-tests.txt`
  already has `# spec_file: tests/api/...` set; call this tool for each suggested block
- When you want API test coverage without spending Claude API tokens on generation

---

## Why the local LLM works well here

API tests follow a highly repetitive pattern:

```typescript
test('should return 200 with a list of products', async ({ request }) => {
  const response = await request.get('/api/productsList');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.responseCode).toBe(200);
  expect(Array.isArray(body.products)).toBe(true);
});
```

This is mechanical code generation — mapping an endpoint description to a fixed
template. The 14B local model handles it accurately because:
- No DOM reasoning required
- No POM structure to figure out
- The pattern is the same for every endpoint
- Each test is independent and scoped to one endpoint

---

## What it generates

Tests use Playwright's built-in `request` fixture. The generated file:
- Imports `{ test, expect }` from `'../../fixtures'`
- Uses `request.get()`, `request.post()`, etc. with relative URLs
- Asserts both the HTTP status code and the `responseCode` in the response body
  (this site's API wraps all responses with `{ responseCode: N, ... }`)
- Covers the happy path and key error cases (missing params, invalid credentials)

Example output for the Products API:

```typescript
import { test, expect } from '../../fixtures';

test.describe('Products API', () => {
  test('should return all products with status 200', async ({ request }) => {
    const response = await request.get('/api/productsList');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);
  });

  test('should reject POST to products list with 405', async ({ request }) => {
    const response = await request.post('/api/productsList');
    expect(response.status()).toBe(200); // site returns 200 with error responseCode
    const body = await response.json();
    expect(body.responseCode).toBe(405);
    expect(body.message).toBeTruthy();
  });
});
```

---

## Usage

### From Claude Code

```
Generate API tests for the GET /api/productsList endpoint
Generate API tests for the login endpoint — spec_file: tests/api/auth.spec.ts
Generate API tests for the brands list API
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `description` | yes | Endpoint URL, HTTP method, expected status, fields to validate |
| `test_name` | no | Names the `test()` and `describe()` blocks |
| `spec_file` | no | Target file, e.g. `"tests/api/products.spec.ts"`. Inferred if omitted. |

---

## Auto-run and registry

After writing the spec, the tool:
1. Runs the spec automatically
2. Records passing tests in `TEST_API.md` (not `TEST_CASES.md`)
3. Attempts one auto-fix if the test fails (Claude API for diagnosis)
4. Writes a `/* ⚠️ BROKEN */` or `/* ⚠️ APP BUG */` annotation if it can't be fixed

---

## Full API test workflow

```bash
# 1. Fetch the API documentation page and generate a test backlog
npm run analyze_prd -- --url https://automationexercise.com/api_list

# 2. Review prd-tests.txt — spec_file: tests/api/... is already set
#    Delete the blocks you don't want

# 3. From Claude Code, for each block you kept:
#    "Generate API tests for <endpoint description>"
#    → local LLM generates, runs, records in TEST_API.md (zero API cost)

# 4. Keep TEST_API.md in sync after any manual changes
npm run sync_registry
```

---

## Keeping TEST\_API.md in sync

API tests are tracked separately from UI/E2E tests:
- Passing tests → `TEST_API.md` (passing table)
- App bugs / broken tests → `TEST_API.md` (separate sections)
- `npm run sync_registry` handles both `TEST_CASES.md` and `TEST_API.md`

See [docs/test-registry.md](test-registry.md) for full details.
