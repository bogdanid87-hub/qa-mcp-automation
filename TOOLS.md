# Tool Reference

Quick reference for all tools. See [README.md](README.md) for full documentation.

---

## MCP tools (Claude Code chat)

### `generate_pom` — build a locator-only POM from the live page

Inspects the real DOM and generates a `pages/X.ts` file with only `readonly Locator`
properties — no methods. Run this before `generate_test` when working on a new page
to guarantee correct locators and skip the fix-loop.

```
Generate a POM for the login page
Generate POMs for /login and /checkout
Generate a POM for /payment — name it PaymentPage
```

| Parameter | Required | Example |
|-----------|----------|---------|
| `urls` | yes | `["/login", "/checkout"]` |
| `page_name` | no (single URL only) | `"PaymentPage"` |

---

### `generate_test` — write a Playwright test end-to-end

Generates the spec file and any missing POMs, runs the test automatically, attempts
auto-fix on failure, and records the result in `TEST_CASES.md`.

```
Generate a test for the contact us form
Generate a test for the login flow — page_paths: /login
```

| Parameter | Required | Example |
|-----------|----------|---------|
| `description` | yes | test steps or description |
| `test_name` | no | `"login"` → `tests/login.spec.ts` |
| `page_paths` | no (but recommended) | `["/login", "/checkout"]` |

> **Tip:** Always provide `page_paths` for accurate locators. For complex flows
> (3+ pages), run `generate_pom` on all pages first.

---

### `inspect_page` — see what's on a page before writing code

Returns headings, form structure, and all DOM elements with their best locator.
Useful for exploring a page before deciding what to test.

```
Inspect the page at /products
Inspect /login and /checkout
```

| Parameter | Required | Example |
|-----------|----------|---------|
| `paths` | yes | `["/login"]` |

---

### `investigate_and_fix` — diagnose and fix a failing test

Classifies the failure (code bug vs app bug), patches the file, saves a learned rule,
and re-runs to verify. If it's an app bug the test is annotated but never modified.

```
Investigate and fix this failure: <paste output>
Investigate and fix the failures in tests/login.spec.ts
```

| Parameter | Required | Example |
|-----------|----------|---------|
| `test_output` | no | paste of Playwright output |
| `pattern` | no | `"tests/login.spec.ts"` |

If neither is provided, all tests are run automatically first.

---

### `run_tests` — run the test suite

```
Run the tests
Run tests matching tests/cart.spec.ts
```

| Parameter | Required | Example |
|-----------|----------|---------|
| `pattern` | no | `"tests/cart.spec.ts"` |

---

### `list_resources` — see what already exists

Lists all page objects, fixtures, and spec files. Always check this before generating
a new test to avoid duplicating existing code.

```
List existing resources
```

---

## Terminal commands

### Test generation

```bash
# Edit my-test.txt with your test description, then:
npm run generate

# Flags (all optional — can also be set inside my-test.txt with # comments)
npm run generate -- --file my-test.txt
npm run generate -- --description "Test the login flow" --page_paths /login
npm run generate -- --test_name login --page_paths /login,/
```

### Fixing failures

```bash
npm run fix                                              # run all, fix whatever fails
npm run fix -- --pattern tests/login.spec.ts            # target one spec
npm run fix -- --output "Error: locator '#btn' ..."     # use pre-captured output
```

### Registry maintenance

```bash
# Re-check only the entries already recorded as broken/app-bug (fast)
npm run update-registry

# Full reconciliation — runs all tests, adds undocumented passing tests,
# promotes resolved broken entries, flags regressions (2 failures required)
npm run sync-registry
```

### Running tests directly

```bash
npm test                    # all tests, headless
npm run test:headed         # browser visible
npm run test:debug          # Playwright inspector
npm run test:report         # open HTML report
```

### Server

```bash
npm run mcp                 # start MCP server manually (Claude Code does this automatically)
```

---

## Recommended flow

```
New page, no POM yet:
  1. generate_pom /the-page         → correct locators on disk
  2. generate_test                  → adds methods + spec, auto-runs

Existing page with a POM:
  1. generate_test                  → adds to existing POM + spec, auto-runs

Something failed:
  1. investigate_and_fix            → diagnose, patch, learn, re-run

Registry out of sync (manual edits, MCP crash):
  1. npm run sync-registry          → reconcile TEST_CASES.md with actual results
```
