# QA MCP Automation

An AI-powered Playwright test generator built as a **Model Context Protocol (MCP) server**.

Describe a test scenario in plain English. The server uses **Claude Sonnet 4.6** to inspect the live page, write the Playwright TypeScript code, and save it to disk — following every project convention automatically.

**Stack:** TypeScript · Playwright · Claude Sonnet 4.6 · Ollama · MCP · Node.js

---

## What this project demonstrates

### MCP server architecture
A custom [Model Context Protocol](https://modelcontextprotocol.io) server that exposes eight AI-driven tools to Claude Code (or any MCP client). Each tool is a TypeScript function registered with a Zod schema; the client discovers the tools automatically and calls them based on natural-language requests. This is the production pattern for building AI-augmented developer tools — not a one-off script, but a structured, discoverable API surface.

### Dual-model routing with local LLM fallback
The project uses two AI models for different tasks based on what each does best and what it costs:

- **Ollama (`qwen2.5-coder:14b`)** handles POM generation — a mechanical task of mapping live DOM elements to TypeScript `readonly Locator` properties. This runs locally, costs nothing, and fires all required POMs in parallel via `Promise.all`.
- **Claude Sonnet 4.6** handles spec generation, failure diagnosis, and PRD analysis — tasks that require reasoning about intent, test structure, and multi-file context. Always used for accuracy-critical work.
- If Ollama is not running, the CLI prompts the user and offers to start it automatically; the MCP server falls back silently with a stderr warning.

### Orchestrator-worker pattern for complex flows
When a test spans multiple pages (e.g. a 20-step checkout flow), a single "generate everything" call produces too many POMs to handle reliably. Instead:
1. Claude makes a cheap planning call (JSON list of files + methods needed, ~$0.003)
2. The local LLM builds each POM in parallel — each call is focused on one page
3. If any POM fails the method-drop guard or the local model returns null, Claude fills the gap
4. Claude writes the spec reading the committed POMs from disk (no method-name mismatches)

### Cost optimisation without sacrificing accuracy
Several deliberate decisions to reduce API spend while preserving output quality:

- **Prompt caching** — the system prompt and per-call codebase context are marked `cache_control: ephemeral`; within the 5-minute TTL, repeated calls pay 90% less for input tokens
- **Focused context** — instead of sending every source file on every call, only files relevant to the current task are sent in full; everything else is listed by name, keeping Claude aware of what exists without wasting tokens on unrelated code
- **Budget separation** — generation runs without a cap (stopping mid-generation wastes money and produces nothing useful); the $0.30 budget applies only to the interactive fix retry loop where costs are genuinely unbounded

### Self-improving rule system
Every time `investigate_and_fix` resolves a failure, the root cause and the corrective rule are appended to `src/prompts/learned-rules.md`. This file is injected into the system prompt on every subsequent generation call. Ten lessons have been accumulated so far (wrong import styles, carousel visibility quirks, `waitForLoadState` timing on this specific site, etc.) — the system gets measurably better with each fixed bug.

### Failure classification before fixing
The fix tool classifies every failure as a **code bug** or an **app bug** before touching anything. Code bugs (wrong locator, bad selector, import error) are fixed automatically. App bugs — where the test is correct but the application under test behaves differently from the assertion — are never "fixed" by changing the test. Instead a structured `/* ⚠️ APP BUG */` annotation is written into the spec and the entry is recorded in `TESTS_UI.md` under a separate section. This preserves the test as documentation of a real defect.

The fix tool also reads the Playwright screenshot and live DOM snapshot at point of failure (Claude is multimodal), so locator errors can be corrected from what was actually on screen rather than from source code alone.

### PRD risk analysis with multi-format input
`analyze_prd` accepts text, Markdown, PDFs (passed natively to the Claude API — no third-party parser), and images (wireframes, mockups via vision). It classifies features by risk tier (critical → revenue impact, high → trust/data, medium → conversion, low → content), generates test suggestions in a structured batch format, and filters against existing `TESTS_UI.md` coverage so the output is a genuine gap list. The `--tier` and `--focus` flags scope the output to a sprint without re-running the full analysis.

### Test registry and reconciliation

> **Format note:** Registries are intentionally stored as human-readable Markdown files (`TESTS_UI.md`, `TESTS_API.md`, `TESTS_E2E.md`). This works well at the scale of a typical automation project (hundreds of tests) and makes test status immediately visible without tooling. At very large scale (thousands of tests), SQLite would be the correct storage choice — indexed lookups, atomic writes, no full-file rewrites on every update — with Markdown generated on demand as a report. This portfolio project uses Markdown because human readability and zero-dependency simplicity are the right trade-offs here.
`TESTS_UI.md` is a markdown file maintained automatically — passing tests, app bugs, and broken tests each have their own section. The `sync-registry` command runs the full suite, adds any undocumented passing tests, promotes resolved broken entries, and flags regressions — but only after running the spec twice to rule out transient failures (the site runs on shared infrastructure with variable load). Fuzzy name matching (normalising articles and punctuation) prevents stale broken entries when test names drift between generation attempts.

---

## Prerequisites

- **Node.js** 18 or later
- **An Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- **Claude Code** — [install guide](https://docs.anthropic.com/en/docs/claude-code)
- **Ollama** (optional, recommended) — offloads POM generation to a local model at no API cost

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/qa-mcp-automation.git
cd qa-mcp-automation
npm install
npx playwright install chromium
```

### 2. Configure the MCP server

Copy the example and fill in your values:

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```

Then edit `.claude/settings.local.json`:
- Replace `/absolute/path/to/your/clone` with the output of `pwd` inside the project folder
- Replace `sk-ant-your-key-here` with your Anthropic API key

The file is gitignored and must never be committed — it contains your API key and a machine-specific path.

### 3. (Optional) Set up local LLM

Install [Ollama](https://ollama.com) and pull the model:

```bash
ollama pull qwen2.5-coder:14b
```

When Ollama is running, POM generation is routed to the local model at no API cost. If Ollama is not running, the CLI will prompt you to start it; the MCP server warns via stderr. To skip Ollama for a session:

```bash
npm run generate -- --file my-test.txt --no-local
NO_LOCAL_LLM=1 npm run generate -- --file my-test.txt   # same via env var
```

---

## Tools

Eight tools are available in Claude Code chat and (most) from the terminal. See [docs/getting-started.md](docs/getting-started.md) for a walkthrough of the first test, [TOOLS.md](TOOLS.md) for a quick index, and [docs/](docs/) for detailed per-tool guides.

| Tool | One-liner | Guide |
|------|-----------|-------|
| `analyze_prd` | Turn a PRD into a risk-prioritised test backlog (`prd-tests.txt`) | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `generate_pom` | Inspect a live page, write a locator-only POM — run before `generate_test` for new pages | [docs/generate-pom.md](docs/generate-pom.md) |
| `generate_api_test` | Generate an API test (request fixture, no browser) — local LLM first, records to `TESTS_API.md` | [docs/generate-api-test.md](docs/generate-api-test.md) |
| `generate_test` | Generate a complete UI/E2E test: POM + spec + auto-run + auto-fix + registry | [docs/generate-test.md](docs/generate-test.md) |
| `inspect_page` | See real DOM elements and locators on a page | [docs/inspect-page.md](docs/inspect-page.md) |
| `investigate_and_fix` | Diagnose a failure (code bug vs app bug), patch, learn, re-run | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `run_tests` | Run the test suite and return output | [docs/run-tests.md](docs/run-tests.md) |
| `list_resources` | List all existing POMs, fixtures, and spec files | [docs/list-resources.md](docs/list-resources.md) |

---

## Recommended workflow

```
From a PRD:
  npm run analyze_prd -- --file prd.md   →  review prd-tests.txt
  npm run generate -- --file prd-tests.txt

New page, no POM yet:
  generate_pom /the-page   →   generate_test

Existing page:
  generate_test

Something failed:
  investigate_and_fix  /  npm run fix -- --pattern tests/ui/auth.spec.ts

Registry out of sync:
  npm run sync_registry
```

---

## Terminal commands

```bash
npm run generate -- --file my-test.txt   # generate from description
npm run analyze_prd -- --file prd.md     # generate test backlog from PRD
npm run fix                               # investigate and fix failing tests
npm run sync_registry                     # reconcile TESTS_UI.md with reality
npm run update_registry                   # re-check only known broken/app-bug entries
npm test                                  # run all tests headless
npm run test:headed                       # browser visible
npm run test:debug                        # Playwright inspector
npm run test:report                       # open HTML report
```

See [docs/test-registry.md](docs/test-registry.md) for when to use `sync-registry` vs `update-registry`.

---

## `my-test.txt` format

Copy `prd.md.example` → `prd.md` to get started with PRDs. For ad-hoc tests, `my-test.txt` (gitignored) uses the same format:

```
# test_name: login-happy-path       ← names the test() and describe() blocks
# spec_file: tests/ui/auth.spec.ts  ← target file (created or appended)
# page_paths: /login, /             ← pages to inspect for correct locators

Test the login flow with valid credentials.
1. Navigate to the login page
2. Fill in email and password
3. Click Login and verify the nav shows "Logged in as <username>"
```

Separate multiple tests with `---` for batch mode (non-interactive, all run in sequence).

---

## Project structure

```
qa-mcp-automation/
│
├── src/                          ← MCP server + CLIs
│   ├── index.ts                  ← MCP server entry point — 8 tools registered
│   ├── cli.ts                    ← npm run generate
│   ├── fix-cli.ts                ← npm run fix
│   ├── analyze-prd-cli.ts        ← npm run analyze_prd
│   ├── sync-registry-cli.ts      ← npm run sync_registry
│   ├── update-registry-cli.ts    ← npm run update_registry
│   └── tools/
│       ├── generate-test.ts      ← Claude for spec; local LLM for POM
│       ├── generate-pom.ts       ← locator-only POM scaffolding
│       ├── analyze-prd.ts        ← PRD risk analysis
│       ├── investigate-fix.ts    ← failure diagnosis + fix (screenshot + DOM aware)
│       ├── local-llm.ts          ← Ollama client with startup prompt
│       ├── inspect-page.ts       ← headless DOM extraction
│       ├── test-registry.ts      ← reads/writes TESTS_UI.md
│       └── budget.ts             ← fix-loop token cost tracking
│
├── docs/                         ← per-tool documentation
├── pages/                        ← Page Object Models
├── fixtures/index.ts             ← custom test + expect (ad-blocking, popups)
├── utils/                        ← adBlocker, popupDismisser, randomData
│
├── tests/
│   ├── global.setup.ts           ← saves guest browser state
│   ├── ui/                       ← single-feature browser tests
│   │   ├── cart.spec.ts
│   │   ├── contact.spec.ts
│   │   ├── search.spec.ts
│   │   └── subscription.spec.ts
│   └── e2e/                      ← full user journeys
│       └── place-order.spec.ts
│
├── CLAUDE.md                     ← auto-loaded by Claude Code — project context
├── TOOLS.md                      ← quick tool index
├── TESTS_UI.md                 ← auto-updated test registry
├── prd.md.example                ← template for PRD analysis (copy to prd.md)
└── playwright.config.ts          ← Chromium only, baseURL, storageState
```

---

## Rules Claude follows

Enforced via `src/prompts/system.ts`; lessons from failures auto-appended to `src/prompts/learned-rules.md`.

| Rule | Detail |
|------|--------|
| Chromium only | No Firefox or WebKit |
| Relative URLs | `page.goto('/login')`, never a full URL |
| POM pattern | Every page has its own class in `pages/` extending `BasePage` |
| Named exports | `export class LoginPage` — never `export default class` |
| Locator priority | `[data-qa]` → role → label → placeholder → text → `#id` |
| `domcontentloaded` | Use instead of `'load'` — this site's `load` event times out |
| Folder conventions | `tests/ui/` for feature tests; `tests/e2e/` for multi-page journeys |
| `test.describe()` name | Broad feature area ("Place Order") — scenario belongs in `test()` name |
| Add, don't duplicate | New tests/locators are added to existing files, never duplicated |
| Randomised data | User names and emails are never hardcoded |
| User cleanup | Tests that create users delete them at the end, even on failure |
| Assertions | Every test has at least one `expect()` |

---

## Troubleshooting

**The MCP server isn't connecting**
- Make sure `.claude/settings.local.json` exists (gitignored — not present after a fresh clone)
- Check that `cwd` is the exact absolute path to your clone (`pwd` inside the project folder)
- Run `npm run mcp` manually and check the terminal for error messages

**`ANTHROPIC_API_KEY is not set`**
- The key must be in the `env` block of `.claude/settings.local.json`, not a `.env` file

**Tests fail on first run**
- Run `npx playwright install chromium` if you haven't done so
- The setup step (`global.setup.ts`) must complete first — it creates `test-data/.auth/guest.json`

**`page.evaluate` errors in `inspect_page`**
- Usually a slow page load — call the tool again and it will succeed
