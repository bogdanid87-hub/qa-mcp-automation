# QA MCP Automation

An AI-powered Playwright test generator built as a **Model Context Protocol (MCP) server**.

Describe a test scenario in plain English. The server uses **Claude Sonnet 4.6** to inspect the live page, write the Playwright TypeScript code, and save it to disk — following every project convention automatically.

**Stack:** TypeScript · Playwright · Claude Sonnet 4.6 · MCP · Node.js

---

## What this project demonstrates

- Building a custom **MCP server** that exposes AI-driven tools to any MCP client (e.g. Claude Code)
- Using the **Anthropic API** to generate structured TypeScript code from natural-language descriptions
- **Headless DOM inspection** — the server navigates pages with Playwright to extract real locators before generating code, so selectors match the actual page
- **Self-improving rules** — when a test fails and is fixed, the lesson is written back into the system prompt so the same mistake never happens again
- **Auto-fix on failure** — after generating a test, if it fails the tool immediately attempts a fix; if it still fails the CLI enters an interactive retry loop with a cost guard
- **Code bug vs app bug detection** — the fix engine classifies every failure: *code bugs* (wrong locator, bad selector) are fixed automatically; *app bugs* (the site behaves differently from what the test asserts) are never "fixed" by changing the test — instead the test is annotated and preserved as documentation of the defect
- **Token budget** — every CLI session is capped at $0.30 by default; when the budget is reached the user is prompted before any further API spend
- **Prompt caching** — the system prompt and per-call codebase context are marked for Anthropic's server-side prompt cache; repeated calls within a session pay the cheap cache-read rate instead of the full input rate
- **Focused context** — instead of sending every source file on every API call, only the files relevant to the current task (failing spec + its imports for fix calls; fixtures + feature-matching files for generate calls) are sent in full; everything else is listed by name only, keeping Claude aware of what exists without wasting tokens on unrelated code
- **Two-phase generation for new POMs** — when no Page Object Model exists for a feature, generation splits into two sequential calls: the first commits the POM to disk, the second generates the spec reading the real POM from context; this eliminates method-name mismatches that occur when both files are invented simultaneously in a single pass; when a POM already exists the single-call path is preserved
- **Test annotations** — unresolvable failures are annotated in-place: `/* ⚠️ BROKEN */` for code issues that exceeded the budget, `/* ⚠️ APP BUG */` for confirmed application defects
- **Additional test proposals** — after generating a test, the server proposes further scenarios (negative cases, edge cases, boundary conditions, alternative happy paths); the user picks which ones to generate, saving unnecessary API calls
- **Duplicate detection** — before calling the API, the CLI checks `TEST_CASES.md` for similar existing tests and warns the user; aborting still offers any missing additional tests for that feature
- **Auto-tracked test registry** — `TEST_CASES.md` is updated automatically: passing tests are recorded in the main table; unresolvable failures are recorded under **⚠️ Application Bugs** or **❌ Broken Tests**; running the suite manually never touches the registry. Run `npm run update-registry` to re-check broken/app-bug entries and promote resolved tests back to the passing section. Run `npm run sync-registry` to do a full reconciliation — runs all tests, adds undocumented passing tests, promotes resolved entries, and flags regressions
- A complete **Playwright test framework**: Page Object Model, custom fixtures, ad-blocking, popup handling, storageState, randomised test data, API-based user setup/teardown

---

## How it works

```
You describe a test scenario
          ↓
CLI checks TEST_CASES.md for similar tests — warns you before spending any tokens
          ↓
MCP server navigates the page headlessly (optional but recommended)
          ↓
Claude Sonnet 4.6 reads the real DOM + your codebase + all enforced rules
          ↓
Test is generated and saved — added to the existing spec/POM if one already exists
          ↓
The new spec is run automatically
          ↓
  Passes → recorded in TEST_CASES.md
  Fails  → auto-fix attempted — Claude classifies the failure first:
           code bug  → patches the code, saves lesson, re-runs
           app bug   → test is NOT changed; ⚠️ APP BUG annotation written into the spec + recorded in TEST_CASES.md
         → code bug still failing → ⚠️ BROKEN annotation written into the spec + recorded in TEST_CASES.md
         → code bug still failing → interactive retry loop with live token-budget display
         → budget reached or user declines → ⚠️ BROKEN annotation written into the spec + recorded in TEST_CASES.md
          ↓
Proposed additional tests are listed — you choose which ones to generate (same flow)
          ↓
If a test needs manual fixing later, run: npm run fix [-- --pattern tests/foo.spec.ts]
```

---

## Prerequisites

- **Node.js** 18 or later — [download](https://nodejs.org)
- **An Anthropic API key** — [get one here](https://console.anthropic.com)
- **Claude Code** (the MCP client used in this project) — [install guide](https://docs.anthropic.com/en/docs/claude-code)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/qa-mcp-automation.git
cd qa-mcp-automation
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install the Chromium browser

```bash
npx playwright install chromium
```

### 4. Configure the MCP server

The file `.claude/settings.local.json` is **not committed to this repo** (it contains your API key and the absolute path to your local clone — both are machine-specific). You need to create it yourself.

First, get the absolute path to your clone:

```bash
pwd
# e.g. /Users/yourname/projects/qa-mcp-automation
```

Then create the file at `.claude/settings.local.json` with the following content, substituting your values:

```json
{
  "mcpServers": {
    "qa-mcp-automation": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/from/pwd/above",
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-your-key-here"
      }
    }
  }
}
```

> **Security note:** Keep this file local. It is listed in `.gitignore` and must never be committed.

### 5. Start the MCP server

If you are using **Claude Code**, the server starts automatically when you open this folder — no extra step needed.

To verify the server starts correctly, run it manually:

```bash
npm run mcp
```

You should see `qa-mcp-automation MCP server running` in the terminal.

---

## Using the tools

Once the MCP server is connected, five tools are available inside Claude Code.

> **Important:** Tools are invoked by typing messages in the **Claude Code chat**, not in the terminal. Open Claude Code in this project folder, start a conversation, and type the examples below directly into the chat. Claude will call the MCP tool on your behalf.

---

### Tool 1 — `generate_test`

Describe what you want to test. Claude writes the POM and test file and saves them to disk.

**Smart file handling:** If a spec file already exists for the same feature area (e.g. `contactUs.spec.ts`), the new test is added inside that file under the matching `test.describe` block — no new file is created. The same applies to POMs: if `ContactUsPage.ts` already exists, any new locators or methods are added to it rather than creating a duplicate.

Type this in the Claude Code chat:

**Basic example** (Claude infers locators from training knowledge):
```
Generate a test for the login flow:
1. Go to /login
2. Enter email and password
3. Click the Login button
4. Verify the user is logged in
```

**Recommended — with live page inspection** (Claude uses real locators from the DOM):
```
Generate a test for the login flow:
1. Go to /login
2. Enter email and password
3. Click the Login button
4. Verify the user is logged in

Use page_paths: ["/login"]
```

When `page_paths` is provided, the server navigates to each page headlessly, extracts every `[data-qa]` attribute, ID, placeholder, and role from the live DOM, and passes that to Claude. The generated locators will match the actual page.

**Passing implementation hints in parentheses:**

You can add extra context to any step using `()` without it being treated as a test step. Claude reads it as a supplementary instruction about how to implement that step:

```
Generate a test for the home page:
1. Navigate to /
2. Verify the home page is loaded (also check the carousel is visible — add it to the existing verifyLoaded() method)
3. Click on Products
4. Verify the products page heading is visible (reuse the existing ProductsPage POM if it already exists)
```

Useful for things like: pointing to an existing method to extend, specifying a locator strategy, noting that an element is inside a modal, or clarifying which POM file to update.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `description` | Yes | What the test should do, in plain text or numbered steps |
| `test_name` | No | Hint for the file name — e.g. `"login"` → `tests/login.spec.ts` |
| `page_paths` | No | Pages to inspect for real locators — e.g. `["/login", "/"]` |

**Auto-run, auto-fix, and registry update:**

After saving the files, `generate_test` immediately runs the new spec with Playwright. If it passes, the test is recorded in `TEST_CASES.md` and a confirmation is shown.

If it fails, the tool automatically attempts a fix: it asks Claude to diagnose the root cause, patches the relevant files, saves the lesson to `learned-rules.md`, and re-runs. If the fix works, the test is recorded. If it still fails, the CLI enters an interactive retry loop — each attempt shows the running token cost, and when the configured budget ($0.30 by default) is reached you are asked whether to continue. If you decline, a `/* ⚠️ BROKEN */` comment is written directly before the failing `test()` call so it is easy to find and fix manually later.

**Additional test proposals:**

After writing the test, `generate_test` also proposes further scenarios (negative cases, edge cases, boundary conditions, alternative happy paths) — but does not generate code for them yet. Proposals that are already recorded in `TEST_CASES.md` are filtered out so you are only shown scenarios that haven't been implemented. The full output looks like this:

```
✅ Contact Us form happy-path test added to tests/contactUs.spec.ts

Files written:
  - tests/contactUs.spec.ts (updated)

✅ 1 test passed — recorded in TEST_CASES.md

Proposed additional tests — call generate_test again with the ones you want:
  1. should show an error when the email field is empty — Submits the form without an email and asserts a validation message appears.
  2. should show an error when all fields are blank — Clicks Submit with no input and checks that the form does not proceed.
  3. should reject an invalid email format — Enters a malformed email and verifies the form flags it before submission.
```

Reply with the numbers you want (e.g. "generate additional tests 1 and 3") and call `generate_test` again with those scenarios. No tokens are spent on tests you don't need.

---

### Tool 2 — `inspect_page`

Navigate to a page and see its real elements before generating a test. Useful for exploring what locators are available.

Type this in the Claude Code chat:

```
Inspect the page at /login
```

Returns a structured snapshot of every interactive element on the page:

```
## DOM snapshot: /login

### Elements (use these for locators — listed in priority order)
  - [data-qa="login-email"] [input] | type="email" | placeholder="Email Address"
  - [data-qa="login-password"] [input] | type="password" | placeholder="Password"
  - [data-qa="login-button"] [button] | text="Login"
  ...
```

---

### Tool 3 — `run_tests`

Run all tests or a specific test file. Type this in the Claude Code chat:

```
Run all tests
```
```
Run tests/login.spec.ts
```

Returns the full Playwright output including pass/fail status. This tool only runs and reports — it never modifies `TEST_CASES.md`.

---

### Tool 4 — `investigate_and_fix`

When a test fails, this tool:
1. Reads the failure output and the relevant source files
2. Asks Claude to classify the failure — **code bug** or **app bug**
3. **Code bug** → fixes the code, extracts a reusable lesson, saves it to `src/prompts/learned-rules.md`, re-runs to verify, records passing tests in `TEST_CASES.md`
4. **App bug** → does **not** touch the test; reports what the application actually does so you can decide whether to file a bug or accept the behaviour

Type this in the Claude Code chat:

**Option A — paste the failure output:**
```
Investigate and fix this failure:
Error: locator.click: strict mode violation: getByRole('link', { name: /home/i })
resolved to 2 elements ...
```

**Option B — let it run the tests automatically:**
```
Investigate and fix the failures in tests/login.spec.ts
```

After the fix, the learned rule is appended to `src/prompts/learned-rules.md` and automatically included in all future `generate_test` calls.

---

### Tool 5 — `list_resources`

See what page objects, fixtures, and tests already exist in the project.

Type this in the Claude Code chat:

```
List existing resources
```

Returns:
```
### Pages (POMs)
  - pages/BasePage.ts
  - pages/ContactUsPage.ts
  - pages/HomePage.ts

### Fixtures
  - fixtures/index.ts

### Tests
  - tests/contactUs.spec.ts
```

Always check this before generating a new test to understand what already exists.

---

## Recommended workflow

```
1. list_resources              → see what already exists
2. inspect_page                → explore the page structure and available locators
3. generate_test               → create the positive test (use page_paths for best results)
                                 ↳ auto-runs; auto-fixes on failure; records in TEST_CASES.md if passing
4. investigate_and_fix         → deeper fix if auto-fix could not resolve it
                                 ↳ re-runs after fixing; records in TEST_CASES.md if now passing
5. review proposed additions   → pick which additional tests to generate (or skip)
6. generate_test (additions)   → generate the selected additional tests (same auto-run + record flow)
7. run_tests                   → optional: run the full suite to check nothing else broke
```

---

## Generating tests from the terminal

Instead of going through the Claude Code chat, you can drive test generation entirely from the terminal using `my-test.txt`:

### 1. Edit `my-test.txt`

A ready-to-use template is included as `my-test.txt.example`. Copy it to get started:

```bash
cp my-test.txt.example my-test.txt
```

Replace the description with what you want to test:

```
# test_name: login
# page_paths: /login

Test the login flow:
1. Navigate to /login
2. Enter a valid email and password
3. Click the Login button
4. Verify the user is redirected to the home page
5. Verify the logged-in username is visible in the navigation
```

`# test_name` and `# page_paths` are optional metadata lines read by the CLI — they set the spec file name and the pages to inspect for real locators. All other `#` lines are treated as comments and ignored.

### 2. Run the generator

```bash
npm run generate -- --file my-test.txt
```

The CLI will:
1. Check `TEST_CASES.md` for similar existing tests and warn you before spending any tokens
2. Generate the test code (and inspect the live page if `page_paths` is set)
3. Run the new spec automatically
4. Record it in `TEST_CASES.md` if it passes
5. Print a summary of which files were **created** and which were **edited**
6. Offer any proposed additional tests that haven't been generated yet
7. Ask whether to run the full test suite before exiting:

```
────────────────────────────────────────────────
  Created:
    + pages/LoginPage.ts
    + tests/login.spec.ts
  Edited:
    ~ fixtures/index.ts
    ~ TEST_CASES.md
────────────────────────────────────────────────

Proposed additional tests:

  1. should show error when email is invalid
     Enters a malformed email and verifies the form flags it.
  2. should show error when password is too short
     Enters a password below the minimum length and checks for a validation message.

Generate which additional tests? Enter numbers (e.g. 1,3), "all", or Enter to skip:

Run all tests to verify nothing is broken? [y/N]
```

**Duplicate detection**

Before calling the API, the CLI compares your description against every entry in `TEST_CASES.md`. If a similar test already exists, it is shown with its number and spec file path:

```
────────────────────────────────────────────────
  ⚠️  Similar test(s) already exist:

  #3  Subscription › should subscribe via the footer subscription form on the home page
       in tests/subscription.spec.ts

────────────────────────────────────────────────
Generate a new test anyway? [y/N]
```

- Answer **`y`** to generate a new test regardless.
- Answer **`N`** (or press Enter) to skip generation — but the CLI will still check whether any **additional tests** for that feature are missing and offer to generate them.

```
⏳ Checking for additional test scenarios...

────────────────────────────────────────────────
  Proposed additional tests:

  1. should show error for invalid email format
     ...
────────────────────────────────────────────────
Generate which additional tests? Enter numbers (e.g. 1,3), "all", or Enter to skip:
```

Additional tests that are already recorded in `TEST_CASES.md` are filtered out automatically — only genuinely new scenarios are offered.

You can also override or skip the metadata by passing flags directly:

```bash
npm run generate -- --file my-test.txt --page_paths /login,/ --test_name login
npm run generate -- --description "Test the login flow..." --page_paths /login
```

> **Note:** `my-test.txt` is listed in `.gitignore` — it is a local working file and is not committed to the repository.

---

## Fixing failing tests from the terminal

Use `npm run fix` when a test is failing and you want Claude to diagnose and patch it without going through the Claude Code chat.

```bash
npm run fix                                              # run all tests, fix whatever fails
npm run fix -- --pattern tests/subscription.spec.ts     # target one spec file
npm run fix -- --output "Error: locator '#btn' ..."     # use pre-captured failure output
```

The command enters an interactive fix loop:

```
▶ Running tests matching "tests/subscription.spec.ts"...

⏳ Investigating and fixing...

────────────────────────────────────────────────
  Root cause:
  The subscribe button locator '#subscribe' was not found — the element ID changed to '#subscribe-btn'

  Fixed files:
    ~ pages/HomePage.ts

  Lesson learned (added to rules):
    Always verify button IDs against the live DOM before using them as locators.

  Budget used: $0.0821 of $0.30 limit
────────────────────────────────────────────────

✅ Fixed — 1 test now passing — recorded in TEST_CASES.md
```

If the first fix attempt does not resolve the failure, the CLI asks whether to try again. Each subsequent attempt displays the updated budget. When the $0.30 limit is reached you are prompted before any further spend:

```
────────────────────────────────────────────────
  ⚠️  Token budget of $0.30 reached ($0.3012 of $0.30 limit).
────────────────────────────────────────────────
Continue spending tokens anyway? [y/N]
```

If you answer **`N`**, the CLI writes an annotation directly before the failing `test()` call. The annotation type depends on the verdict:

**Code bug that couldn't be resolved** — annotated as `BROKEN`:
```typescript
/* ⚠️  BROKEN — failed and exceeded the auto-fix token budget.
 * Root cause: Element '#subscribe-btn' not found after multiple fix attempts.
 * Fix manually or run: npm run fix */
test('should show error for invalid email', async ({ homePage }) => {
```

**Application defect** — annotated as `APP BUG` (the test is correct and is left unchanged):
```typescript
/* ⚠️  APP BUG — This test is correct; the application under test has a defect.
 * Expected behaviour: duplicate email subscriptions should be rejected
 * Actual behaviour:   the site accepts duplicate subscriptions and shows success each time
 * Do NOT change this test — it documents a real bug. Fix the application instead. */
test('should not accept duplicate email subscriptions', async ({ homePage }) => {
```

**Token budget**

The default limit is **$0.30 per session** (roughly 1 generate call + 2–3 fix attempts at current Claude Sonnet 4.6 pricing). The budget is tracked from actual token usage returned by the API — including prompt cache write and read costs — not estimated. To change the limit, update `DEFAULT_BUDGET_USD` in [src/cli.ts](src/cli.ts) and [src/fix-cli.ts](src/fix-cli.ts).

---

## Syncing TEST_CASES.md

`TEST_CASES.md` is updated automatically during MCP flows, but it can drift if:
- A server error interrupts an MCP call before the write completes
- Tests are added or edited by hand, or written with Claude Code instead of the MCP server
- A test regresses after it was recorded as passing

Run `npm run sync-registry` to do a full reconciliation:

```bash
npm run sync-registry
```

```
⏳ Running full test suite...

▶ 14 passed, 2 failed (16 total)

📝 Adding 2 undocumented passing test(s):
   + tests/cart.spec.ts › Cart › should add a product to the cart
   + tests/cart.spec.ts › Cart › should remove a product from the cart

⚡ 2 candidate regression(s) — re-running to rule out transient failures...

   ↺  Re-running tests/login.spec.ts...
   ↺  Re-running tests/checkout.spec.ts...

⚡ 1 test(s) passed on re-run — likely transient (high traffic / network blip), not flagged:
   ~ tests/checkout.spec.ts › Checkout › should complete a purchase

⚠️  Flagging 1 confirmed regression(s) as broken (failed twice):
   ❌ tests/login.spec.ts › Login › should login with valid credentials

   ⚠️  BROKEN comments were NOT added to spec files — run `npm run fix -- --pattern <spec>` for each.

✅ TEST_CASES.md updated (3 changes).
```

What it does in one pass:
- **Adds** any passing test that is not yet in `TEST_CASES.md` — whether it was written manually, by Claude Code, or through a failed MCP write
- **Promotes** broken/app-bug entries that now pass back to the passing section
- **Confirms regressions with a re-run** — if a previously-passing test fails, the spec is re-run once before deciding; tests that pass on the second attempt are skipped (transient/flaky), only tests that fail twice are moved to `❌ Broken Tests`

Use `npm run update-registry` instead when you only want to re-check the entries already recorded as broken or app-bug (faster — does not run the whole suite).

---

## Running tests directly

You can run the Playwright tests without going through the MCP server:

```bash
npm test                    # run all tests (headless)
npm run test:headed         # run with the browser visible
npm run test:debug          # step through with the Playwright inspector
npm run test:report         # open the HTML test report
npm run generate            # generate a new test from my-test.txt
npm run fix                 # fix failing tests with Claude (interactive, budget-controlled)
npm run update-registry     # re-run broken/app-bug tests and update TEST_CASES.md if resolved
npm run sync-registry       # full reconciliation: run all tests, sync TEST_CASES.md completely
```

---

## Project structure

```
qa-mcp-automation/
│
├── src/                          ← MCP server + CLIs
│   ├── index.ts                  ← MCP server entry point — 5 tools registered here
│   ├── cli.ts                    ← npm run generate — test generation with prompts, budget, retry loop
│   ├── fix-cli.ts                ← npm run fix — standalone fix loop with budget guard
│   ├── update-registry-cli.ts    ← npm run update-registry — re-checks broken/app-bug tests, updates TEST_CASES.md
│   ├── sync-registry-cli.ts      ← npm run sync-registry — full reconciliation between test results and TEST_CASES.md
│   ├── tools/
│   │   ├── generate-test.ts      ← calls Claude to write test code; auto-runs, auto-fixes, records
│   │   ├── inspect-page.ts       ← headless DOM extraction
│   │   ├── investigate-fix.ts    ← failure analysis, fix, re-run, rule learning + recording
│   │   ├── list-resources.ts     ← lists existing files
│   │   ├── run-tests.ts          ← shells out to Playwright (run and report only)
│   │   ├── test-registry.ts      ← shared logic for reading/writing TEST_CASES.md
│   │   └── budget.ts             ← TokenBudget class — tracks real API token cost per session
│   └── prompts/
│       ├── system.ts             ← all rules sent to Claude on every call
│       └── learned-rules.md      ← lessons from past failures (auto-updated)
│
├── pages/                        ← Page Object Models
│   ├── BasePage.ts               ← base class with navigate() and popup handling
│   ├── HomePage.ts
│   └── ContactUsPage.ts
│
├── fixtures/
│   └── index.ts                  ← custom test + expect (ad-blocking, popup dismissal)
│
├── utils/
│   ├── adBlocker.ts              ← blocks ad network requests globally
│   ├── popupDismisser.ts         ← dismisses cookie/consent overlays
│   └── randomData.ts             ← generates random names, emails, passwords
│
├── tests/
│   ├── global.setup.ts           ← saves guest browser state before tests run
│   └── contactUs.spec.ts         ← example: Contact Us form tests
│
├── test-data/
│   └── sample-upload.txt         ← sample file used in upload tests
│
├── my-test.txt                   ← local template for terminal-driven test generation (gitignored)
├── TEST_CASES.md                 ← auto-updated registry: passing tests, app bugs, and broken tests
└── playwright.config.ts          ← Chromium only, baseURL, storageState
```

---

## Rules Claude follows

Every generated test and POM follows these conventions, enforced via the system prompt in `src/prompts/system.ts`:

| Rule | Detail |
|------|--------|
| Chromium only | No Firefox or WebKit |
| Relative URLs | `page.goto('/login')`, never a full URL |
| POM pattern | Every page has its own class in `pages/` extending `BasePage` |
| Locator priority | `[data-qa]` → role → label → placeholder → text → `#id` |
| Add, don't duplicate | If a spec or POM for the feature already exists, new tests/locators are added to it |
| Popup dismissal | Handled once by the fixture — never manually in tests |
| Randomised data | User names and emails are never hardcoded |
| User cleanup | Tests that create users delete them at the end, even on failure |
| API-first login | Tests that need an authenticated user create the account via API first |
| Assertions | Every test has at least one `expect()` |
| Additional test proposals | Proposed after every test (negative cases, edge cases, alternative happy paths); no code is written until the user confirms |
| Step comments | Every logical block in a test has a comment — `// Step N:` when steps are numbered, natural language otherwise |

Lessons learned from `investigate_and_fix` are appended to `src/prompts/learned-rules.md` and treated as additional mandatory rules on every subsequent generation.

---

## Troubleshooting

**The MCP server isn't connecting**
- Make sure you created `.claude/settings.local.json` (it is gitignored — not present after a fresh clone)
- Check that `cwd` in that file is the exact absolute path to your local clone (use `pwd` inside the project folder)
- Run `npm run mcp` manually and check the terminal for error messages

**`ANTHROPIC_API_KEY is not set`**
- The key must be in the `env` block of `.claude/settings.local.json`, not in a `.env` file

**Tests fail on first run**
- Run `npx playwright install chromium` if you haven't done so
- The setup step (`global.setup.ts`) must complete before tests run — it creates `test-data/.auth/guest.json`

**`page.evaluate` errors in `inspect_page`**
- Usually caused by a slow page load — call the tool again and it will succeed
