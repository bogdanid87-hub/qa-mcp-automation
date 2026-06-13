# Project Conventions

Decisions made during development that affect how the project is named, structured,
and extended.

---

## Naming — MCP tools and CLI commands use the same name

**Decision:** npm scripts use underscores to match MCP tool names.

```bash
npm run analyze_prd      # matches the MCP tool: analyze_prd
npm run sync_registry    # consistent underscore style
npm run update_registry  # consistent underscore style
```

**Why:** MCP tool names follow the JSON/API convention of `snake_case` (e.g.
`analyze_prd`, `generate_test`). npm scripts conventionally use hyphens
(`analyze-prd`), but having two different names for the same functionality —
one for Claude Code chat and one for the terminal — caused user confusion.
A user who learned the MCP tool name `analyze_prd` instinctively typed
`analyze_prd` in the terminal and got `command not found`.

Underscores in npm scripts are valid (`npm run analyze_prd` works fine).
The small deviation from npm convention is worth the gain in consistency.

**Exceptions** — some CLI commands don't have a direct MCP equivalent and
keep short, intuitive names:

| CLI command | Why not renamed |
|-------------|----------------|
| `npm run generate` | Wraps `generate_test` + batch mode; `generate_test` would be misleading |
| `npm run generate_api` | CLI for `generate_api_test` — shortened to `generate_api` since `generate_api_test` is long for a daily command |
| `npm run fix` | Short for `investigate_and_fix`; the full name would be verbose in daily use |
| `npm run mcp` | Meta-command to start the server; no MCP tool equivalent |
| `npm test`, `npm run test:headed` etc. | Playwright conventions; no MCP equivalent |

---

## Test folder structure

Tests are split by *how* they test, not by *what* they test:

| Folder | Type | Registry |
|--------|------|---------|
| `tests/ui/` | Single-feature browser tests | `TESTS_UI.md` |
| `tests/e2e/` | Full user journeys (multi-page) | `TESTS_E2E.md` |
| `tests/api/` | Direct HTTP tests (no browser) | `TESTS_API.md` |

**Why separate registries:** API tests and UI/E2E tests have different failure
characteristics, different fix strategies, and different app-bug patterns. Mixing
them in one file would make it harder to assess the health of each testing layer
independently.

---

## POM hierarchy

Page Object Models follow a three-level inheritance chain:

```
BasePage          — navigate(), popup handling only
  └── SitePage    — nav bar, footer subscription, loggedInAs (all site pages)
        ├── HomePage
        ├── CartPage
        ├── LoginPage
        ├── CheckoutPage
        ├── AccountPage
        ├── ContactUsPage
        └── ProductListPage  — product card grid, cart modal (listing pages)
              └── ProductsPage  — search box, headings (specific to /products)
```

**When to extend which class:**

| Class | Use when |
|---|---|
| `SitePage` | Any full page of the site — has the nav bar and footer |
| `ProductListPage` | Pages that show a product card grid with sidebar: `/products`, `/category_products/:id`, `/brand_products/:slug` |
| `BasePage` | Only for pages with no site nav/footer (isolated forms, modals) |

**Locators already owned by parents — never re-declare in subclasses:**

`SitePage`: `logo`, `navContactUs`, `navProducts`, `loggedInAs`, `footer`, `subscriptionHeading`, `subscribeEmailInput`, `subscribeBtn`, `subscribeSuccessMessage`

`ProductListPage`: `productCards`, `cartModal`, `continueShoppingBtn`, `viewCartLink`

**Determining the hierarchy for a new project:** run `npm run audit_site -- --url <url>` before writing any POMs. It crawls the site, builds a component-presence matrix, and recommends which elements belong in shared vs page-specific classes.

---

## AI model routing

| Task | Model | Reason |
|------|-------|--------|
| Spec generation | Claude API always | Requires reasoning about intent and test structure |
| POM generation | Local LLM → Claude fallback | Mechanical DOM-to-TypeScript mapping; 14B model handles it reliably |
| API test generation | Local LLM → Claude fallback | Most repetitive pattern in the project; ideal for local model |
| Failure diagnosis and fix | Claude API always | Requires multimodal reasoning (screenshots + DOM) |
| PRD analysis | Claude API always | Requires risk classification and multi-feature reasoning |

**Both generation and the fix loop run to completion by default** — stopping
mid-generation or mid-fix wastes money and produces nothing useful. Cost is
tracked and displayed after each attempt. Pass `--budget N` to either CLI
to opt in to a spending cap (useful when sharing an API key with a usage quota).

**`--budget N` aborts vs. warns depending on call size.** Before each Claude call,
`TokenBudget.wouldExceed()` estimates whether it would push spend past the cap:
- The **fix loop** (`investigate-fix.ts`) aborts the call before sending —
  partial diagnosis is useless, so there's nothing to lose by stopping early.
- **Generation calls** (`generate-test.ts`, `generate-pom.ts`) only warn and
  continue — a partial POM/spec is still progress, and aborting mid-generation
  would waste the tokens already spent reaching that point.

---

## `test.describe()` naming

`test.describe()` names the **feature area**, not the test scenario:

```typescript
// ✓ Correct — broad enough to group all order flow variants
test.describe('Place Order', () => {
  test('should register during checkout, place an order, and delete the account', ...)
  test('should place an order as an existing registered user', ...)
})

// ✗ Wrong — scenario-specific, prevents grouping
test.describe('Place Order: Register while Checkout', () => { ... })
```

The specific scenario belongs in the `test()` name. `spec_file` controls which
file a test goes into; `test_name` only names the `test()` and `describe()` blocks.

---

## Safe writes — `src/lib/safe-write.ts`

Every file write in `src/tools/*` goes through `safeWrite(path, content, options)`
instead of `fs.writeFile`. It:

- Creates parent directories as needed.
- Returns `{ ok, written, diff, reason? }` — `diff` is a unified diff of the change
  (useful for previews and for surfacing rejected writes to the user).
- Is a no-op (`ok: true, written: false`) when the new content is identical to
  what's on disk.
- By default (`allowOverwrite: false`), **refuses** to write when the new content
  would either:
  1. Drop an existing `test(...)` or `describe(...)` block present in the old file, or
  2. Shrink a file of ≥5 non-empty lines to less than half its previous size.

**`allowOverwrite: true`** is passed only for files where shrinkage on
regeneration is expected and already vetted by other means:

- POM files (`pages/*.ts`) — an exported-method/locator-drop guard runs first
- `TESTS_UI.md` / `TESTS_API.md` / `TESTS_E2E.md`, `GAPS_BACKLOG.md`,
  `APP_KNOWLEDGE.md`, `coverage-report.md`, `coverage-gaps.txt`,
  `site-audit-report.{md,json}`, `test-data/constants.ts`, PRD output reports —
  all full-regeneration "report/registry" artifacts

Everything else (specs, fixtures, helpers, the fix loop's proposed file changes)
uses the default `allowOverwrite: false`.

**Why:** before this, individual tools (`generate-test.ts`, `generate-pom.ts`)
had their own ad-hoc "don't drop existing tests/methods" checks, and
`investigate-fix.ts`'s auto-fix loop had none — a bad fix could silently
regenerate and shrink a spec. `safeWrite` consolidates the check into one place
and gives the fix loop a way to *refuse* an unsafe rewrite instead of either
applying it or crashing.

**`blockedWrites` in the fix loop:** when `autoFixFailure` (in
`investigate-fix.ts`) proposes a file change that `safeWrite` refuses, the file
is left untouched and the rejection (`{ path, reason, diff }`) is collected in
`AutoFixResult.blockedWrites`. `investigate_and_fix`, `npm run fix`, and the
auto-fix step inside `generate_test` / `generate_api_test` all surface these as
"⛔ Blocked writes — needs human review" so a bad proposed fix is visible
instead of silently dropped.

The same `blockedWrites` list also collects fixes to `tests/**/*.spec.ts` that
would change *what* an existing test asserts (rather than how it reaches the
assertion) — see [investigate-and-fix.md](investigate-and-fix.md#objective-preservation--intent-signature-guard).

---

## `source: direct | suggested` — meaning differs by tool

Both `analyze_prd` and `analyze_coverage` use the `source` field but with subtly
different criteria:

| Tool | `direct` means | `suggested` means |
|------|---------------|-------------------|
| `analyze_prd` | Traced to a specific named item in the source document (API 5, US-03, Test Case 12) — omitting it leaves a documented requirement uncovered | Claude's own addition: negative case, edge case, or boundary condition not explicitly in the source |
| `analyze_coverage` | Corresponds to a path or variant that visibly exists in the spec or app — a real missing test | Gap from testing best practices not directly implied by the existing tests |

In both cases `direct` signals "this gap is non-negotiable" and `suggested`
signals "this is Claude's professional opinion — review before generating".
