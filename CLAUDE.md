# qa-mcp-automation

MCP server that generates Playwright tests for automationexercise.com using the
Claude API and a local LLM. Seven tools cover the full QA workflow from PRD
analysis through test generation, failure investigation, and registry maintenance.

See [TOOLS.md](TOOLS.md) for a quick index and [docs/](docs/) for per-tool guides.

---

## Key commands

```bash
npm run generate -- --file my-test.txt   # generate a test from description
npm run analyze-prd -- --file prd.md     # generate test backlog from a PRD
npm run fix                               # investigate and fix failing tests
npm run sync-registry                     # reconcile TEST_CASES.md with reality
npm run update-registry                   # re-check known broken/app-bug entries
npm test                                  # run all tests headless
npm run mcp                               # start MCP server manually
```

---

## Architecture

```
src/
  index.ts              — MCP server entry point, 7 tools registered
  cli.ts                — npm run generate (interactive, budget-controlled)
  fix-cli.ts            — npm run fix
  analyze-prd-cli.ts    — npm run analyze-prd
  sync-registry-cli.ts  — npm run sync-registry
  update-registry-cli.ts
  tools/
    generate-test.ts    — core test generation (Claude for spec, local LLM for POM)
    generate-pom.ts     — locator-only POM scaffolding from live DOM
    analyze-prd.ts      — PRD risk analysis and test backlog generation
    investigate-fix.ts  — failure diagnosis + fix (reads screenshots + live DOM)
    inspect-page.ts     — headless DOM extraction
    list-resources.ts   — lists existing files (recursive, covers ui/ and e2e/)
    run-tests.ts        — shells out to Playwright
    test-registry.ts    — shared read/write logic for TEST_CASES.md
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
| `TEST_CASES.md` | `generate_test`, `sync-registry`, `update-registry` |
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
| PRD risk analysis | Claude API always |
| Similarity check (before generate) | Claude API (cached test list) |

Local LLM: `qwen2.5-coder:14b` via Ollama (`http://localhost:11434`).
Override with `OLLAMA_HOST` or `LOCAL_MODEL` env vars.
If Ollama is not running, all tasks fall back to Claude API silently.

---

## Important conventions

- POM classes: **named exports only** — `export class LoginPage`, never `export default class`
- BasePage import: `import { BasePage } from './BasePage'` (named, not default)
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
