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
| `tests/ui/` | Single-feature browser tests | `TEST_CASES.md` |
| `tests/e2e/` | Full user journeys (multi-page) | `TEST_CASES.md` |
| `tests/api/` | Direct HTTP tests (no browser) | `TEST_API.md` |

**Why separate registries:** API tests and UI/E2E tests have different failure
characteristics, different fix strategies, and different app-bug patterns. Mixing
them in one file would make it harder to assess the health of each testing layer
independently.

---

## AI model routing

| Task | Model | Reason |
|------|-------|--------|
| Spec generation | Claude API always | Requires reasoning about intent and test structure |
| POM generation | Local LLM → Claude fallback | Mechanical DOM-to-TypeScript mapping; 14B model handles it reliably |
| API test generation | Local LLM → Claude fallback | Most repetitive pattern in the project; ideal for local model |
| Failure diagnosis and fix | Claude API always | Requires multimodal reasoning (screenshots + DOM) |
| PRD analysis | Claude API always | Requires risk classification and multi-feature reasoning |

**The fix loop is the only budget-capped operation.** Generation (POM + spec +
single auto-fix attempt) runs to completion regardless of cost — stopping
mid-generation wastes money and produces nothing useful. The $0.30 budget
applies only to the interactive fix retry loop, where costs are genuinely
unbounded and human judgment is needed at each step.

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
