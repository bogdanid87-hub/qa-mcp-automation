# qa-mcp-automation

MCP server that generates Playwright tests for automationexercise.com using the
Claude API and a local LLM. Eleven tools cover the full QA workflow from PRD
analysis through test generation, auth fixture setup, network mocking, failure
investigation, and registry maintenance.

See [TOOLS.md](TOOLS.md) for a quick index and [docs/](docs/) for per-tool guides.

---

## Collaboration rules (apply to every session)

- **Ask before updating `CLAUDE.md`** — notify the user first and wait for confirmation
- **Never commit or push** without the user explicitly asking for it
- **Never run token-consuming operations** (Claude API calls, Playwright test runs, Ollama inference, `npm run fix`, `npm run generate`, `npm run analyze_prd`, etc.) without first notifying the user and receiving permission
- **Never fix test files directly** without first telling the user the fix is happening outside the tool flow — explain what is being changed and why before touching the file
- **When given permission to fix tests manually:** also update the system prompt, learned rules, or tool code so the same issue cannot recur — a fix that only patches one file without closing the root cause is incomplete
- **When adding or significantly changing a tool:** update ALL of these in the same commit as the code — never as a follow-up:
  - `docs/[tool-name].md` — create or update the per-tool guide
  - `TOOLS.md` — add/update both the MCP tools table and the terminal commands table, with doc links
  - `CLAUDE.md` — update the tool count in the header and add to key commands if daily-use
  - `README.md` — update the tool count (header + tools section + architecture block), add to the tools table and terminal commands list
- **When a general improvement is made here:** ask before propagating to `mcp-qa-skeleton`; only propagate AFTER the tool has been tested on this project and any bugs found have been fixed — propagating untested or newly-fixed tools means the skeleton gets the broken version

---

## Key commands

```bash
npm run generate -- --file my-test.txt   # generate a UI/E2E test from description
npm run generate_api -- --description "..." # generate an API test (local LLM first)
npm run analyze_prd -- --file prd.md     # generate test backlog from a PRD
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts  # coverage gap analysis
npm run fix                               # investigate and fix failing tests
npm run status                            # suite health at a glance
npm run tag_tests                         # tag spec files with registry IDs
npm run audit_site -- --url https://...   # crawl site, build component matrix, recommend POM hierarchy
npm run generate_auth -- --name loggedIn --login-url /login  # generate auth fixture + storage state
npm run generate_mock -- --name stripe --url 'https://api.stripe.com/**' --response "..."  # network mock
npm run sync_registry                     # reconcile all three registries with reality
npm run update_registry                   # re-check known broken/app-bug entries
npm test                                  # run all tests headless
npm run mcp                               # start MCP server manually
```

---

## Architecture

```
src/
  index.ts              — MCP server entry point, 9 tools registered
  cli.ts                — npm run generate (interactive, cost-tracked)
  fix-cli.ts            — npm run fix
  analyze-prd-cli.ts    — npm run analyze_prd
  analyze-coverage-cli.ts — npm run analyze_coverage
  sync-registry-cli.ts  — npm run sync_registry
  update-registry-cli.ts
  status-cli.ts             — npm run status
  tools/
    generate-test.ts    — core test generation (Claude for spec, local LLM for POM)
    generate-pom.ts     — locator-only POM scaffolding from live DOM
    analyze-prd.ts      — PRD risk analysis and test backlog generation
    analyze-coverage.ts — coverage gap analysis; scoped or full-suite, URL context, deep mode
    investigate-fix.ts  — failure diagnosis + fix (reads screenshots + live DOM)
    inspect-page.ts     — headless DOM extraction
    list-resources.ts   — lists existing files (recursive, covers ui/ and e2e/)
    run-tests.ts        — shells out to Playwright
    test-registry.ts    — shared read/write logic for TESTS_UI.md, TESTS_API.md and TESTS_E2E.md
    local-llm.ts        — Ollama client (qwen2.5-coder:14b, falls back to Claude)
    annotations.ts      — writes /* ⚠️ APP BUG */ and /* ⚠️ BROKEN */ into specs
    budget.ts           — token cost tracking per session
  prompts/
    system.ts           — system prompt sent to Claude on every generate call
    learned-rules.md    — lessons auto-appended by investigate_and_fix
```

---

## Test organisation

```
tests/
  global.setup.ts       — saves guest browser state before tests run
  ui/                   — single-feature browser tests
    cart.spec.ts
    contact.spec.ts
    search.spec.ts
    subscription.spec.ts
  e2e/                  — full user journeys (multi-page, multi-step)
    place-order.spec.ts
pages/                  — Page Object Models (one class per page)
fixtures/index.ts       — custom test + expect (ad-blocking + popup handling)
```

**Naming conventions:**
- `test.describe()` = broad feature area ("Place Order", "Cart") — never the scenario
- `test()` = specific scenario ("should register during checkout and place an order")
- `spec_file` directive controls which file a test goes into; `test_name` only names the `test()` and `describe()` blocks

---

## Files that are auto-managed — do not edit manually

| File | Managed by |
|------|-----------|
| `TESTS_UI.md` | `generate_test` tool, `npm run sync_registry`, `npm run update_registry` — UI tests |
| `TESTS_E2E.md` | same — E2E tests (`tests/e2e/`) only |
| `TESTS_API.md` | same — API tests (`tests/api/`) only |
| `src/prompts/learned-rules.md` | `investigate_and_fix` (auto-appends after every fix) |
| `test-data/.auth/guest.json` | `global.setup.ts` (Playwright setup) |

---

## AI routing — which model does what

| Task | Model |
|------|-------|
| POM generation — simple flows (≤ 2 pages) | Local LLM → Claude fallback |
| POM generation — complex flows (> 2 pages) | Claude plans → Local LLM builds in parallel → Claude fills gaps |
| Spec generation | Claude API always |
| Failure investigation and fix | Claude API always (uses screenshots + DOM vision) |
| Coverage gap analysis | Claude API always |
| PRD risk analysis | Claude API always |
| API test generation | Local LLM (qwen2.5-coder:14b) → Claude fallback |
| Similarity check (before generate) | Claude API (cached test list) |

Local LLM: `qwen2.5-coder:14b` via Ollama (`http://localhost:11434`).
Override with `OLLAMA_HOST` or `LOCAL_MODEL` env vars.

If Ollama is not running:
- **CLI** — prompts the user and offers to start it automatically (`open -a Ollama`)
- **MCP server** — warns to stderr, falls back to Claude API

Opt out for a session:
```bash
npm run generate -- --file my-test.txt --no-local   # skip Ollama, use Claude
NO_LOCAL_LLM=1 npm run generate -- --file my-test.txt  # same via env var
```

---

## Important conventions

- POM classes: **named exports only** — `export class LoginPage`, never `export default class`
- POM parent class: extend `SitePage` for any full site page, `ProductListPage` for product listing pages, `BasePage` only for pages without site nav/footer — see [docs/conventions.md](docs/conventions.md#pom-hierarchy)
- All POM parent imports are named: `import { SitePage } from './SitePage'` (never default)
- Spec imports: `import { test, expect } from '../../fixtures'` (two levels up from ui/ or e2e/)
- Locator priority: `[data-qa="..."]` → role → label → placeholder → text → `#id`
- `waitForLoadState`: use `'domcontentloaded'` on this site — `'load'` times out due to third-party scripts
- Never assert `toBeVisible()` on Bootstrap carousel `.item` elements (Rule 004)

---

## my-test.txt directives

```
# test_name: login-happy-path          ← names test() and describe() only
# spec_file: tests/ui/auth.spec.ts     ← target file (created or appended)
# page_paths: /login, /               ← pages to inspect for correct locators
```

Separate multiple tests with `---` for batch mode.

---

## Risk tiers (analyze_prd)

| Tier | Meaning |
|------|---------|
| critical | Revenue — checkout, payment, cart totals |
| high | Trust/data — login, registration, order history |
| medium | Conversion — search, filtering, product detail |
| low | Content — static pages, newsletter, social links |
