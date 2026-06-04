# generate\_test

Generates a Playwright test — UI, API, E2E, or mixed — from a plain-English
description. The type is detected automatically:

- **UI / E2E** — description mentions page navigation, form interactions, or DOM elements
- **API** — description mentions an endpoint URL, HTTP method, or `tests/api/` spec_file
- **Mixed** — API calls alongside browser interactions (API setup → UI flow → API verify)

Creates or updates the Page Object Model (for UI/E2E), writes the spec, runs it
automatically, attempts to fix any failures, and records the result in the correct
registry. The single most-used tool in the project.

---

## What happens when you call it

1. **Similarity check** — Claude compares your description against every existing
   test in `TESTS_UI.md` and warns if the same scenario is already covered
2. **POM step** — if no POM exists for this feature, one is generated first and
   committed to disk before the spec is written (prevents method-name mismatches)
3. **Spec step** — Claude writes the spec file using the POM already on disk
4. **Auto-run** — the new spec is executed immediately
5. **Auto-fix** — if it fails, Claude diagnoses the failure, patches the code,
   saves a learned rule, and re-runs; if it still fails, you're prompted to retry
6. **Registry** — passing tests are recorded in `TESTS_UI.md`; unresolvable
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
across all tests in the batch.

**If the budget is reached mid-batch**, the remaining tests are skipped — they are
not queued or retried automatically. The tests that already completed are fully
written, committed to the registry, and not lost. Example:

```
✅ Test 1 (cart.spec.ts) — passed
✅ Test 2 (search.spec.ts) — passed
⚠️  Spending cap of $0.30 reached after Test 2. Tests 3–5 were not generated.
```

To avoid hitting the budget mid-batch:
- Split large files into smaller batches (3–4 tests per file is a safe size)
- To generate the skipped tests, remove the completed ones from the file and re-run

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
| `dry_run` | no | When `true`: generate code but do NOT write files or run the test. Returns a preview showing the target spec path and proposed code — call again without it to proceed. |

> **Always provide `page_paths`** when you know which pages the test touches.
> Without it, locators are invented rather than extracted from the real DOM.
> For complex flows (3+ pages), run `generate_pom` on all pages first.

> **Use `dry_run: true` before writing** when you want to review the target file path and
> test code before committing tokens to the auto-fix loop. This is the recommended flow for
> any test that touches a page without an existing POM.

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
shows the running token cost. The loop stops after **5 attempts** (override with
`--max-attempts N`) or when the user declines. Pass `--budget N` for an optional
spending cap. In all stop cases a `/* ⚠️ BROKEN */` annotation is written.

---

## Additional test proposals

After writing the main test, the tool proposes further scenarios — negative cases,
edge cases, boundary conditions, alternative happy paths — that aren't covered yet.
No code is generated for these automatically; you choose which ones to implement.

Proposals already recorded in `TESTS_UI.md` are filtered out so you only see
genuinely new suggestions.

---

## Token cost tracking

There is no default spending cap — both generation and the fix loop run to
completion. Cost is tracked from actual API usage (including cache hits and
writes) and displayed after each attempt so you can see what a session costs.

Two optional controls on the fix loop:

```bash
npm run generate -- --file my-test.txt --max-attempts 3   # stop after 3 fix attempts
npm run generate -- --file my-test.txt --budget 1.00      # stop at $1.00 spent
```

**`--max-attempts N`** (default: 5) — stops after N attempts even if the user
keeps answering 'y'. The right guard for a problem Claude can't resolve — five
attempts is a clear signal that manual investigation is needed.

**`--budget N`** — stops at a spending cap. Use for shared API keys with usage quotas.

---

## Registry recording

Results are written to the correct registry automatically based on the spec path:

| Spec location | Registry |
|---------------|---------|
| `tests/ui/` | `TESTS_UI.md` |
| `tests/api/` | `TESTS_API.md` |
| `tests/e2e/` | `TESTS_E2E.md` |

| Outcome | What gets recorded |
|---------|-------------------|
| Test passes | Added to the passing table with a sequential number |
| App bug detected | Added to the `⚠️ Application Bugs` section with root cause and actual behaviour |
| Could not fix | Added to the `❌ Broken Tests` section with root cause |

If `TESTS_UI.md` gets out of sync (server crash, manual edits), run
`npm run sync_registry` to reconcile it — see [docs/test-registry.md](test-registry.md).
