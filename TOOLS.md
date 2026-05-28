# Tool Reference

Quick reference for all tools. See [README.md](README.md) for full documentation.

---

## MCP tools (Claude Code chat)

### `analyze_prd` — turn a PRD into a prioritised test backlog

Reads a PRD (or any feature description) and generates a `prd-tests.txt` file
containing test suggestions grouped by risk level. Filters out tests that already
exist in `TEST_CASES.md` so the output is a genuine gap list.

```
Analyze this PRD and suggest test cases:
[paste PRD text or feature description]
```

| Parameter | Required | Example |
|-----------|----------|---------|
| `prd_content` | yes (MCP) | full PRD text, user stories, or feature description |
| `output_file` | no | `"sprint-12-tests.txt"` (default: `prd-tests.txt`) |
| `tier` | no | `["critical", "high"]` — omit medium and low |
| `focus` | no | `["checkout", "authentication"]` — omit other features |

The output file uses the same format as `my-test.txt`, so you can feed it directly
to `generate_test` without any copy-pasting:

```bash
npm run generate -- --file prd-tests.txt
```

Risk levels: **critical** (revenue) → **high** (trust/data) → **medium** (conversion) → **low** (content/UX)

---

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

### PRD analysis

**`prd.md`** is a local scratch file (gitignored) where you paste a PRD or feature
description. **`prd-tests.txt`** is the generated output (also gitignored).

```bash
# Text / Markdown
npm run analyze-prd -- --file prd.md

# PDF — Claude reads it natively, layout and tables preserved
npm run analyze-prd -- --file spec.pdf

# Image — wireframe, mockup, or screenshot
npm run analyze-prd -- --file wireframe.png

# Text + supplementary images
npm run analyze-prd -- --file prd.md --images wireframe.png,mockup.jpg

# Only critical and high risk tests (skip medium and low)
npm run analyze-prd -- --file prd.md --tier critical,high

# Only tests for specific features
npm run analyze-prd -- --file prd.md --focus checkout,authentication

# Combine filters
npm run analyze-prd -- --file prd.md --tier critical --focus checkout

# Custom output file
npm run analyze-prd -- --file prd.md --output sprint-12-tests.txt

# Generate all suggested tests
npm run generate -- --file prd-tests.txt
```

**PowerPoint / Excel / Word** — export to PDF first, then use `--file spec.pdf`.
Claude reads the PDF natively including any embedded diagrams.

The output contains one test block per suggestion, separated by `---`, with
`# risk:` and `# reason:` annotations for context. Delete the blocks you don't
want before running `generate`.

---

### Test generation

**`my-test.txt`** is a local scratch file (gitignored) used to describe tests
before generating them. Three directives at the top of each block set the
metadata; everything else is the test description.

```
# test_name: login-happy-path       ← names the output file tests/login-happy-path.spec.ts
# page_paths: /login, /             ← pages to inspect live for correct locators

Test the login flow with valid credentials.
1. Navigate to the login page
2. Fill in email and password
3. Click the Login button
4. Verify "Logged in as <username>" appears in the nav
```

Run it:
```bash
npm run generate -- --file my-test.txt
```

**Multiple tests in one file** — separate blocks with `---` on its own line.
All tests run non-interactively in sequence (batch mode):

```
# test_name: login-happy-path
# page_paths: /login
Test login with valid credentials...

---

# test_name: login-wrong-password
# page_paths: /login
Test login with an incorrect password...
```

You can also skip the file and pass everything inline:
```bash
npm run generate -- --description "Test the login flow..." --page_paths /login
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
Starting from a PRD or feature spec:
  1. analyze_prd / npm run analyze-prd  → generate prd-tests.txt (gap list)
  2. review prd-tests.txt               → delete suggestions you don't want
  3. npm run generate -- --file prd-tests.txt  → generate all selected tests

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
