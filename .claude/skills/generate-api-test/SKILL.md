---
name: generate-api-test
description: Generates a Playwright API test (no browser, request fixture) via local LLM → Claude fallback — generate_test auto-detects API, npm run generate_api is the CLI shorthand. Writes to tests/api/, records in TESTS_API.md. Load when writing/discussing API tests.
---

# API test generation

API test generation is handled by [generate-test](../generate-test/SKILL.md) — the
type is auto-detected from the description and `spec_file` path, so there is no
separate MCP tool. `npm run generate_api` is a CLI shorthand that forces the API
path.

## When to use it

- Testing an HTTP endpoint directly (status code, response body, error handling)
- After `npm run analyze_prd -- --url <api-docs-page>` — the generated
  `prd-tests.txt` already has `# spec_file: tests/api/...` set; run with
  `npm run generate --file prd-tests.txt`
- API coverage without spending Claude API tokens — local LLM is primary here

## How to trigger it

```
# MCP — auto-detects from the description
Generate a test for GET /api/productsList that checks it returns at least 20 products
```

```bash
npm run generate_api -- --description "Test GET /api/productsList returns 20+ products"
npm run generate_api -- --file my-api-test.txt
npm run generate -- --description "Test GET /api/productsList" --type api   # equivalent
```

## Why the local LLM works well here

API tests follow a highly repetitive pattern — mapping an endpoint description to
a fixed template, no DOM/POM reasoning, each test independent and scoped to one
endpoint. The 14B local model handles this accurately.

## What it generates

`{ test, expect }` from `'../../fixtures'`, `request.get/post/...` with relative
URLs, asserts both the HTTP status code AND `responseCode` in the body (this
site's API wraps all responses with `{ responseCode: N, ... }`). Covers happy path
+ key error cases (missing params, invalid credentials):

```typescript
import { test, expect } from '../../fixtures';

test.describe('Products API', () => {
  test('should return all products with status 200', async ({ request }) => {
    const response = await request.get('/api/productsList');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.responseCode).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
  });
});
```

## Parameters

| Parameter | CLI flag | MCP param | Description |
|-----------|----------|-----------|-------------|
| Description | `--description` | `description` | Endpoint URL, HTTP method, expected status, fields to validate |
| Test name | `--test_name` | `test_name` | Names `test()`/`describe()` |
| Spec file | `--spec_file` | `spec_file` | Target file, e.g. `"tests/api/products.spec.ts"` — inferred if omitted |
| File | `--file` | — | Read description from a file (CLI only) |

## Auto-run and registry

Runs the spec automatically, records passing tests in `TESTS_API.md` (not
`TESTS_UI.md`), attempts one auto-fix on failure, writes `/* ⚠️ BROKEN */` or
`/* ⚠️ APP BUG */` if it can't be fixed. `npm run sync_registry` handles
`TESTS_API.md` alongside `TESTS_UI.md` — see
[docs/test-registry.md](../../../docs/test-registry.md).

## Full workflow

```bash
npm run analyze_prd -- --url https://automationexercise.com/api_list   # build backlog
# review prd-tests.txt — spec_file: tests/api/... already set
npm run generate -- --file prd-tests.txt                                # generate
npm run sync_registry                                                    # keep TESTS_API.md in sync
```

Full guide: [docs/generate-api-test.md](../../../docs/generate-api-test.md)
