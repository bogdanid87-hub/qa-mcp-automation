# qa-mcp-automation

MCP server that generates Playwright tests for automationexercise.com using the
Claude API and a local LLM. Thirteen tools cover the full QA workflow from PRD
analysis through test generation, auth fixture setup, network mocking, failure
investigation, registry maintenance, app knowledge synthesis, and E2E journey
planning.

See [TOOLS.md](TOOLS.md) for a quick index, [docs/](docs/) for per-tool guides, and
`.claude/skills/` for collaboration rules and conventions Claude Code loads on demand
during sessions in this repo.

Project-specific values (site URL, registry paths, risk-tier keywords, POM class
hierarchy) live in [mcp-qa.config.json](mcp-qa.config.json), loaded by
[src/config.ts](src/config.ts).

---

## Always-on safety rules

The full collaboration rules — branch/PR workflow, the tool-update checklist,
propagation to the skeleton, look-ahead checks — live in
[.claude/skills/qa-workflow/SKILL.md](.claude/skills/qa-workflow/SKILL.md) and load
whenever you're about to change code, run commands, or open a PR. These apply even
before that:

- **Ask before updating `CLAUDE.md`** — notify the user first and wait for confirmation.
- **Never commit or push without the user explicitly asking.**
- **Never run token-consuming operations** (Claude API calls, Playwright runs, Ollama
  inference, `npm run fix`/`generate`/`analyze_prd` etc.) without first notifying the
  user and receiving permission.
- **Never commit changes to `tests/`, `pages/`, `fixtures/`, or `src/prompts/`**
  without running the affected spec first (`npx playwright test --project=chromium
  <spec>`) and confirming it passes. No exceptions.
- **Never fix a test file directly** without first telling the user what's changing
  and why.
- **Use PRs for all changes** — never push directly to `main` (only the skeleton,
  `mcp-qa-skeleton`, takes direct pushes).

---

## Key commands

```bash
npm run generate -- --file workspace/my-test.txt   # generate a UI/E2E test from description
npm run generate_api -- --description "..." # generate an API test (local LLM first)
npm run analyze_prd -- --file workspace/prd.md     # generate test backlog from a PRD
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts  # coverage gap analysis
npm run fix                               # investigate and fix failing tests (max 2 attempts)
npm run fix -- --max-attempts 3          # override attempt limit
npm run status                            # suite health at a glance
npm run tag_tests                         # tag spec files with registry IDs
npm run audit_site -- --url https://...   # crawl site, build component matrix, recommend POM hierarchy
npm run init_project -- --name <name> --url <site-url>  # bootstrap mcp-qa.config.json + pages/fixtures/tests scaffold for a new project
npm run generate_auth -- --name loggedIn --login-url /login  # generate auth fixture + storage state
npm run generate_mock -- --name stripe --url 'https://api.stripe.com/**' --response "..."  # network mock
npm run generate_knowledge                # synthesise workspace/APP_KNOWLEDGE.md (enriches analyze_prd + analyze_coverage)
npm run sync_registry                     # reconcile all three registries with reality
npm run update_registry                   # re-check known broken/app-bug entries
npm test                                  # run all tests headless (Chromium)
npm run test:all-browsers                 # run on Chromium + Firefox + WebKit
npm run test:visual                       # visual regression tests only
npm run test:update-snapshots             # regenerate visual baselines after UI changes
npm run test:unit                         # run server unit tests (no live site, no API key)
npm run lint                              # ESLint — src/ and scripts/
npm run mcp                               # start MCP server manually
```

---

## Architecture

```
src/
  config.ts             — loads mcp-qa.config.json; derives SITE_URL, registry paths, risk tiers, POM hierarchy
  server.ts             — createServer(): McpServer factory, all 13 tools registered; library entry point (package.json "exports")
  index.ts              — MCP server entry point, connects createServer() to stdio (npm run mcp)
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
    generate-app-knowledge.ts — synthesises APP_KNOWLEDGE.md from bugs, gaps, coverage report
    plan-e2e.ts         — look-ahead E2E journey planner; cross-references the POM Method Index
    pom-index.ts        — POM Method Index builder, shared by generate-test and plan-e2e
    init-project.ts     — bootstraps mcp-qa.config.json + pages/fixtures/tests scaffold for a new project
    init-project-templates.ts — BasePage/SitePage/fixtures placeholder templates used by init-project.ts
    review-generation.ts — hybrid pre-write reviewer (deterministic checks + 1 LLM call) for generate-test
    annotations.ts      — writes /* ⚠️ APP BUG */ and /* ⚠️ BROKEN */ into specs
    budget.ts           — token cost tracking per session
  prompts/
    system.ts           — system prompt sent to Claude on every generate call
```

---

## Conventions, test layout, and auto-managed files

POM class hierarchy, locator priority and pitfalls (incl. locator-uniqueness),
navigation rules, the `tests/`/`pages/`/`fixtures/` layout and naming conventions,
the `trackCleanup` fixture, and the table of auto-managed files (`TESTS_UI.md`,
`learned-rules.md`, etc.) all live in
[qa-conventions](.claude/skills/qa-conventions/SKILL.md) — loaded automatically when
editing `pages/`, `tests/`, or `fixtures/`.

---

## AI routing — which model does what

See [docs/conventions.md#ai-model-routing](docs/conventions.md#ai-model-routing) for the full task → model table.

Local LLM: `qwen2.5-coder:14b` via Ollama (`http://localhost:11434`).
Override with `OLLAMA_HOST` or `LOCAL_MODEL` env vars.

If Ollama is not running:
- **CLI** — prompts the user and offers to start it automatically (`open -a Ollama`)
- **MCP server** — warns to stderr, falls back to Claude API

Opt out for a session:
```bash
npm run generate -- --file workspace/my-test.txt --no-local   # skip Ollama, use Claude
NO_LOCAL_LLM=1 npm run generate -- --file workspace/my-test.txt  # same via env var
```

---

## Risk tiers and my-test.txt format

Risk tiers (critical/high/medium/low, with examples) —
[analyze-prd](.claude/skills/analyze-prd/SKILL.md#risk-tiers).

`my-test.txt` batch-file directives (`test_name`/`spec_file`/`page_paths`, `---`
separators) —
[generate-test](.claude/skills/generate-test/SKILL.md#terminal-usage--my-testtxt).
