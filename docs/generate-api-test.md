# generate\_api (CLI) / generate\_test with API auto-detection

API test generation is now handled by `generate_test` — the type is detected
automatically from the description and spec_file path, so there is **no separate
MCP tool**. The `npm run generate_api` CLI shorthand still exists for convenience.

Generates a Playwright API test using the `request` fixture — no browser, no DOM,
no page objects. Uses the local LLM (Ollama) as the primary generator; falls back
to the Claude API automatically. Writes to `tests/api/` and records results in
`TESTS_API.md`.

---

## When to use it

- Testing an HTTP endpoint directly (status code, response body, error handling)
- After running `npm run analyze_prd -- --url <api-docs-page>` — the generated `workspace/prd-tests.txt`
  already has `# spec_file: tests/api/...` set; use `npm run generate --file workspace/prd-tests.txt`
- When you want API test coverage without spending Claude API tokens on generation

## How to trigger it

From Claude Code — `generate_test` auto-detects:
```
Generate a test for GET /api/productsList that checks it returns at least 20 products
```

From the terminal — `generate_api` shorthand forces the API path:
```bash
npm run generate_api -- --description "Test GET /api/productsList returns 20+ products"
npm run generate_api -- --file my-api-test.txt
```

From the main CLI — same as `generate_api`:
```bash
npm run generate -- --description "Test GET /api/productsList" --type api
```

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

### From the terminal

```bash
# Inline description
npm run generate_api -- --description "Test the GET /api/productsList endpoint. Assert status 200, responseCode 200, and that products is a non-empty array."

# With explicit target file
npm run generate_api -- --description "Test GET /api/productsList" --spec_file tests/api/products.spec.ts

# From a file (same format as my-test.txt — # test_name and # spec_file directives supported)
npm run generate_api -- --file my-api-test.txt
```

### From Claude Code

```
Generate API tests for the GET /api/productsList endpoint
Generate API tests for the login endpoint — spec_file: tests/api/auth.spec.ts
Generate API tests for the brands list API
```

### Parameters

| Parameter | CLI flag | MCP param | Description |
|-----------|----------|-----------|-------------|
| Description | `--description` | `description` | Endpoint URL, HTTP method, expected status, fields to validate |
| Test name | `--test_name` | `test_name` | Names the `test()` and `describe()` blocks |
| Spec file | `--spec_file` | `spec_file` | Target file, e.g. `"tests/api/products.spec.ts"`. Inferred if omitted. |
| File | `--file` | — | Read description from a file (CLI only) |

---

## Auto-run and registry

After writing the spec, the tool:
1. Runs the spec automatically
2. Records passing tests in `TESTS_API.md` (not `TESTS_UI.md`)
3. Attempts one auto-fix if the test fails (Claude API for diagnosis)
4. Writes a `/* ⚠️ BROKEN */` or `/* ⚠️ APP BUG */` annotation if it can't be fixed

---

## Full API test workflow

```bash
# 1. Fetch the API documentation page and generate a test backlog
npm run analyze_prd -- --url https://automationexercise.com/api_list

# 2. Review workspace/prd-tests.txt — spec_file: tests/api/... is already set
#    Delete the blocks you don't want

# 3. Generate tests — terminal or Claude Code

# Terminal: pass each description inline
npm run generate_api -- --description "Test GET /api/productsList" --spec_file tests/api/products.spec.ts
npm run generate_api -- --description "Test POST /api/verifyLogin" --spec_file tests/api/auth.spec.ts

# Claude Code: type naturally
# "Generate API tests for the GET /api/productsList endpoint"

# 4. Keep TESTS_API.md in sync after any manual changes
npm run sync_registry
```

---

## Keeping TEST\_API.md in sync

API tests are tracked separately from UI/E2E tests:
- Passing tests → `TESTS_API.md` (passing table)
- App bugs / broken tests → `TESTS_API.md` (separate sections)
- `npm run sync_registry` handles both `TESTS_UI.md` and `TESTS_API.md`

See [docs/test-registry.md](test-registry.md) for full details.
