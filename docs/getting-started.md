# Getting Started

This guide walks through the first steps after setup: generating your first test,
understanding the output, running the full CLI flow, and using the PRD analysis tool.

For full setup instructions (API key, MCP config, Ollama), see the [README](../README.md).
The quickest start after cloning:

```bash
npm install
npx playwright install chromium
cp .claude/settings.local.json.example .claude/settings.local.json
# edit .claude/settings.local.json — add your API key and absolute path
```

---

## Your first test from Claude Code chat

Once the MCP server is connected in Claude Code, type directly in the chat:

```
Generate a test for the contact us form:
1. Navigate to /contact_us
2. Fill in the name, email, subject, and message
3. Upload a file
4. Click Submit
5. Verify the success message appears

Use page_paths: ["/contact_us"]
```

Claude will:
1. Inspect the live `/contact_us` page and extract real DOM locators
2. Check `TESTS_UI.md` — if a similar test exists it will warn you
3. Generate `pages/ContactUsPage.ts` (locators + methods) and `tests/ui/contact.spec.ts`
4. Run the spec automatically
5. Record the result in `TESTS_UI.md` if it passes
6. Propose additional test scenarios (negative cases, edge cases) — you pick which to generate

> **Tip:** `page_paths` is optional but strongly recommended. Without it, locators are
> invented rather than extracted from the real DOM, which often causes failures.

---

## Your first test from the terminal

### 1. Prepare `my-test.txt`

Copy the example:
```bash
cp prd.md.example prd.md   # for PRD analysis
# for ad-hoc tests, create my-test.txt manually (it's gitignored)
```

Or create `my-test.txt` directly:

```
# test_name: login-happy-path
# spec_file: tests/ui/auth.spec.ts
# page_paths: /login

Test the login flow with valid credentials.
1. Navigate to the login page
2. Fill in a valid email and password
3. Click the Login button
4. Verify "Logged in as <username>" appears in the navigation bar
```

**Directives** (all optional):

| Directive | Effect |
|-----------|--------|
| `# test_name:` | Names the `test()` and `describe()` blocks |
| `# spec_file:` | Target file — created if missing, appended if it exists |
| `# page_paths:` | Pages to inspect live for correct locators |

Everything else is the test description. Lines starting with `#` that aren't one of
these directives are treated as comments and ignored.

### 2. Run the generator

```bash
npm run generate -- --file my-test.txt
```

You'll see:
```
  Checking for existing coverage...

⏳ Generating test...

✅ Login happy-path test added to tests/ui/auth.spec.ts

Files written:
  - pages/LoginPage.ts
  - tests/ui/auth.spec.ts
  - fixtures/index.ts (updated)

_(POMs planned by Claude API, built in parallel by qwen2.5-coder:14b — method names guaranteed consistent)_

✅ 1 test passed — recorded in TESTS_UI.md

Proposed additional tests:
  1. should show error when email is invalid ...
  2. should show error when password is wrong ...

Generate which additional tests? Enter numbers (e.g. 1,3), "all", or Enter to skip:
```

### 3. Multiple tests in one file

Separate test blocks with `---` on its own line — all run non-interactively in sequence:

```
# test_name: login-happy-path
# spec_file: tests/ui/auth.spec.ts
# page_paths: /login
Test valid login...

---

# test_name: login-wrong-password
# spec_file: tests/ui/auth.spec.ts
# page_paths: /login
Test login with wrong password...
```

```bash
npm run generate -- --file my-test.txt
```

---

## Understanding the output

### When a test passes

```
✅ 1 test passed — recorded in TESTS_UI.md
```

The test is added to the passing section of `TESTS_UI.md`. Done.

### When a test fails — auto-fix

```
⚠️ Initial run failed — attempting auto-fix...
```

The tool reads the failure output, the Playwright screenshot, and the live DOM of the
failing page, then asks Claude to diagnose and patch the code. If it works:

```
✅ Auto-fix applied — 1 test now passing — recorded in TESTS_UI.md
  Root cause: Locator '[data-qa="login-btn"]' not found — correct selector is '[data-qa="login-button"]'
  Lesson learned: Always verify data-qa values against the live DOM before writing locators.
```

The lesson is appended to `src/prompts/learned-rules.md` and injected into every
future generation call.

### When auto-fix can't resolve it

```
❌ Could not auto-fix — annotated in the spec with ⚠️ BROKEN
  Root cause: ...
```

A `/* ⚠️ BROKEN */` comment is written before the failing `test()` call, and the
entry appears in `TESTS_UI.md` under `❌ Broken Tests`. Run `npm run fix` later
to investigate with a fresh attempt.

### When it's an application bug

```
⚠️ Application bug detected — the test is correct but the site behaves differently.
  What the site does: The cart quantity field is read-only — no input element exists.
  The test was NOT modified — annotated in the spec with ⚠️ APP BUG.
```

The test documents a real defect. It appears in `TESTS_UI.md` under
`⚠️ Application Bugs`. The test is never changed — it's correct.

---

## Fixing a failing test

### From Claude Code chat

```
Investigate and fix the failures in tests/ui/auth.spec.ts
```

### From the terminal

```bash
npm run fix                                              # run all, fix whatever fails
npm run fix -- --pattern tests/ui/auth.spec.ts          # target one spec
npm run fix -- --output "Error: locator '#btn' ..."     # use pre-captured output
```

The fix loop shows a running cost after each attempt and asks before each retry:

```
────────────────────────────────────────────────
  Cost so far: $0.08 spent
────────────────────────────────────────────────
Test is still failing. Attempt another fix? [y/N]
```

The loop stops after **5 attempts by default** — a hard guard against a problem
Claude can't resolve. Pass `--max-attempts N` to override, or `--budget N` for
a spending cap. See [docs/investigate-and-fix.md](investigate-and-fix.md) for details.

---

## Generating tests from a PRD

### 1. Prepare your PRD

```bash
cp prd.md.example prd.md
# Replace the example content with your PRD
```

Or point directly at an existing file — PDF, image, or text:

```bash
npm run analyze_prd -- --file ~/Downloads/feature-spec.pdf
npm run analyze_prd -- --file prd.md --images wireframe.png
```

### 2. Review the output

`prd-tests.txt` is written with one test block per suggestion, in risk order
(critical first). Each block looks like:

```
# test_name: checkout-guest-happy-path
# spec_file: tests/e2e/place-order.spec.ts
# page_paths: /view_cart, /checkout, /payment
# risk: critical
# reason: End-to-end purchase path — failure here means lost revenue.

Test that a guest user can complete a full purchase.
1. Add a product to the cart
...
```

Delete the blocks you don't want, then generate:

```bash
npm run generate -- --file prd-tests.txt
```

Use `--tier` or `--focus` to scope the analysis before writing the file:

```bash
npm run analyze_prd -- --file prd.md --tier critical,high
npm run analyze_prd -- --file prd.md --focus checkout,authentication
```

See [docs/analyze-prd.md](analyze-prd.md) for full details.

---

## Generating API tests

Use `generate_api_test` for direct HTTP endpoint tests — no browser, no page objects,
uses the local LLM (free) by default:

```
Generate API tests for the GET /api/productsList endpoint
Generate API tests for the login endpoint — spec_file: tests/api/auth.spec.ts
```

Or generate a whole backlog from an API docs page:

```bash
npm run analyze_prd -- --url https://automationexercise.com/api_list
# review prd-tests.txt, then for each test use generate_api_test from Claude Code
```

API tests go to `tests/api/` and are recorded in `TESTS_API.md` (separate from
`TESTS_UI.md`). See [docs/generate-api-test.md](generate-api-test.md) for details.

---

## Keeping TESTS_UI.md in sync

If you've added tests manually, fixed tests outside the MCP tools, or had a server
error mid-generation, run:

```bash
npm run sync_registry
```

This runs the full suite, adds missing passing tests, promotes resolved broken entries,
and flags regressions — but only after a second run to rule out transient failures.

For a faster check (only re-runs known broken/app-bug entries):

```bash
npm run update_registry
```

The same commands handle both `TESTS_UI.md` (UI/E2E tests) and `TESTS_API.md` (API
tests) automatically — routing is based on spec path.

See [docs/test-registry.md](test-registry.md) for full details on the registry structure.
