# generate\_test

> **For API tests** (HTTP endpoints, request fixture, no browser) use
> [`generate_api_test`](generate-api-test.md) instead — it uses the local LLM by
> default (free) and records to `TEST_API.md` automatically.



Generates a complete Playwright test: creates or updates the Page Object Model,
writes the spec file, runs it automatically, attempts to fix any failures, and
records the result in `TEST_CASES.md`. The single most-used tool in the project.

---

## What happens when you call it

1. **Similarity check** — Claude compares your description against every existing
   test in `TEST_CASES.md` and warns if the same scenario is already covered
2. **POM step** — if no POM exists for this feature, one is generated first and
   committed to disk before the spec is written (prevents method-name mismatches)
3. **Spec step** — Claude writes the spec file using the POM already on disk
4. **Auto-run** — the new spec is executed immediately
5. **Auto-fix** — if it fails, Claude diagnoses the failure, patches the code,
   saves a learned rule, and re-runs; if it still fails, you're prompted to retry
6. **Registry** — passing tests are recorded in `TEST_CASES.md`; unresolvable
   failures are annotated in the spec file and recorded as broken or app-bug

---

## POM generation: local LLM vs Claude API

| Scenario | POM step | Spec step |
|----------|----------|-----------|
| POM already exists | skipped | Claude API |
| New POM, simple flow (≤ 2 page paths) | Local LLM → Claude fallback | Claude API |
| New POM, complex flow (> 2 page paths) | Claude plans → Local LLM builds in parallel → Claude fills any gaps | Claude API |

The spec step always uses the Claude API — it requires the most accuracy.

---

## Using `my-test.txt` (terminal)

`my-test.txt` is a local scratch file (gitignored) for describing the test before
generating it. Three directives at the top control metadata:

```
# test_name: login-happy-path       ← names the test() and describe() blocks
# spec_file: tests/ui/auth.spec.ts  ← target file (created if missing, appended if exists)
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

### Multiple tests in one file (batch mode)

Separate test blocks with `---` on its own line. All blocks run non-interactively:

```
# test_name: login-happy-path
# page_paths: /login
Test login with valid credentials...

---

# test_name: login-wrong-password
# page_paths: /login
Test login with an incorrect password...
```

The CLI shows a per-test result and a final summary. The token budget accumulates
across all tests, and if it's reached mid-batch the remaining tests are skipped.

### Inline flags (no file)

```bash
npm run generate -- --description "Test the login flow..." --page_paths /login
npm run generate -- --test_name login --page_paths /login,/
```

---

## From Claude Code (MCP)

```
Generate a test for the contact us form
Generate a test for the login flow — page_paths: /login
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `description` | yes | Test steps or description of what to test |
| `test_name` | no | Names the `test()` and `describe()` blocks — does not control the filename |
| `spec_file` | no | Target spec file, e.g. `"tests/ui/auth.spec.ts"` or `"tests/e2e/place-order.spec.ts"` |
| `page_paths` | no (recommended) | Pages to inspect live for accurate locators |

> **Always provide `page_paths`** when you know which pages the test touches.
> Without it, locators are invented rather than extracted from the real DOM.
> For complex flows (3+ pages), run `generate_pom` on all pages first.

---

## Auto-fix loop

If the generated test fails on the first run, the tool:

1. Reads the failure output — including the Playwright screenshot and live DOM
   snapshot of the failing page
2. Classifies the failure as a **code bug** or **app bug**
3. **Code bug** → patches the relevant file, saves a learned rule, re-runs to verify
4. **App bug** → writes a `/* ⚠️ APP BUG */` annotation directly before the failing
   `test()` call; the test is **not** modified because it correctly documents a defect

If the auto-fix doesn't resolve the failure, the CLI prompts to retry. Each attempt
shows the running token cost. When the $0.30 budget is reached you're asked whether
to continue. Declining writes a `/* ⚠️ BROKEN */` annotation.

---

## Additional test proposals

After writing the main test, the tool proposes further scenarios — negative cases,
edge cases, boundary conditions, alternative happy paths — that aren't covered yet.
No code is generated for these automatically; you choose which ones to implement.

Proposals already recorded in `TEST_CASES.md` are filtered out so you only see
genuinely new suggestions.

---

## Token budget

The default per-session budget is **$0.30**. This covers roughly one generate call
plus two or three fix attempts at current Sonnet 4.6 pricing. The budget is tracked
from actual API usage (including cache hits and writes), not estimated.

To change it, update `DEFAULT_BUDGET_USD` in `src/cli.ts` and `src/fix-cli.ts`.

---

## Registry recording

Results are written to the correct registry automatically based on the spec path:

| Spec location | Registry |
|---------------|---------|
| `tests/ui/`, `tests/e2e/` | `TEST_CASES.md` |
| `tests/api/` | `TEST_API.md` |

| Outcome | What gets recorded |
|---------|-------------------|
| Test passes | Added to the passing table with a sequential number |
| App bug detected | Added to the `⚠️ Application Bugs` section with root cause and actual behaviour |
| Could not fix | Added to the `❌ Broken Tests` section with root cause |

If `TEST_CASES.md` gets out of sync (server crash, manual edits), run
`npm run sync_registry` to reconcile it — see [docs/test-registry.md](test-registry.md).
