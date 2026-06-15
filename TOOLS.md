# Tool Reference

Quick index of all available tools. New here? Start with [docs/getting-started.md](docs/getting-started.md).
Detailed per-tool guides are in the `docs/` folder. Project naming and architecture decisions: [docs/conventions.md](docs/conventions.md).

---

## MCP tools (Claude Code chat)

| Tool | What it does | Doc |
|------|-------------|-----|
| `analyze_coverage` | Analyse the existing test suite for gaps and risk areas; writes `coverage-report.md` and optionally `coverage-gaps.txt` | [docs/analyze-coverage.md](docs/analyze-coverage.md) |
| `analyze_prd` | Read a PRD or feature description and generate a risk-prioritised test backlog in `prd-tests.txt` | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `generate_pom` | Inspect a live page and generate a locator-only POM file — run this before `generate_test` when starting on a new page | [docs/generate-pom.md](docs/generate-pom.md) |
| `generate_test` | Generate a UI, API, E2E, or mixed Playwright test — type auto-detected from description and spec_file path. POM + spec + auto-run + auto-fix + registry update | [docs/generate-test.md](docs/generate-test.md) |
| `inspect_page` | Navigate to a page headlessly and return all DOM elements with their best locator | [docs/inspect-page.md](docs/inspect-page.md) |
| `investigate_and_fix` | Diagnose a failing test (code bug vs app bug), patch the file, and save a learned rule | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `run_tests` | Run tests and return output — `pattern` targets a file, `grep` runs a single test by name, `browser` selects the project (`chromium`/`firefox`/`webkit`/`visual`) | [docs/run-tests.md](docs/run-tests.md) |
| `list_resources` | List all existing page objects, fixtures, and spec files | [docs/list-resources.md](docs/list-resources.md) |
| `generate_auth_fixture` | Generate a Playwright auth fixture for form or OAuth login — saves browser storage state and adds a named fixture | [docs/generate-auth-fixture.md](docs/generate-auth-fixture.md) |
| `generate_mock` | Generate a `page.route()` network mock — intercepts a URL and returns a controlled response | [docs/generate-mock.md](docs/generate-mock.md) |
| `generate_app_knowledge` | Synthesise app bugs, coverage gaps, and coverage report into `APP_KNOWLEDGE.md` — enriches subsequent `analyze_prd` and `analyze_coverage` calls | [docs/generate-app-knowledge.md](docs/generate-app-knowledge.md) |
| `plan_e2e` | Plan a multi-page E2E journey before generating it — decomposes the flow into POMs/methods and cross-references the POM Method Index for a step → view → POM → exists? → action checklist | [docs/plan-e2e.md](docs/plan-e2e.md) |
| `init_project` | Bootstrap `mcp-qa.config.json` plus a minimal pages/fixtures/tests scaffold for a new project — picks a riskTiers profile, prints next steps (audit_site → generate_pom → generate_test) | [docs/init-project.md](docs/init-project.md) |
| `review_rules` | List stale rules and near-duplicate rule pairs across `learned-rules.md`/`framework-rules.md`; `promote` moves a rule into `framework-rules.md` so it applies to every project | [docs/review-rules.md](docs/review-rules.md) |

---

## Terminal commands

| Command | What it does | Doc |
|---------|-------------|-----|
| `npm run analyze_coverage` | CLI version of `analyze_coverage` — scope by spec, folder, or registry; optional URL | [docs/analyze-coverage.md](docs/analyze-coverage.md) |
| `npm run analyze_prd` | CLI version of `analyze_prd` — supports PDF and image inputs | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `npm run generate_api` | Shorthand for generating an API test — forces `type=api`, otherwise identical to `npm run generate` | [docs/generate-api-test.md](docs/generate-api-test.md) |
| `npm run generate_auth` | Generate a Playwright auth fixture for form or OAuth login — saves storage state and adds a named fixture | [docs/generate-auth-fixture.md](docs/generate-auth-fixture.md) |
| `npm run generate_mock` | Generate a `page.route()` network mock — intercepts a URL and returns a controlled response | [docs/generate-mock.md](docs/generate-mock.md) |
| `npm run audit_site` | Crawl a site, build a page-type × UI-component matrix, and recommend a POM hierarchy | [docs/audit-site.md](docs/audit-site.md) |
| `npm run init_project` | Bootstrap `mcp-qa.config.json` plus a minimal pages/fixtures/tests scaffold for a new project | [docs/init-project.md](docs/init-project.md) |
| `npm run review_rules` | Rule hygiene report (stale + near-duplicate rules); `-- --promote <NNN>` moves a rule from `learned-rules.md` to `framework-rules.md` | [docs/review-rules.md](docs/review-rules.md) |
| `npm run generate_knowledge` | CLI version of `generate_app_knowledge` — synthesises `APP_KNOWLEDGE.md` from registries, backlog, and coverage report | [docs/generate-app-knowledge.md](docs/generate-app-knowledge.md) |
| `npm run generate` | Generate a test from `my-test.txt` (or any batch `.txt` file) | [docs/generate-test.md](docs/generate-test.md) |
| `npm run fix` | Interactive fix loop for failing tests | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `npm run status` | Suite health at a glance: registry counts, tagging ratio, open backlog gaps, spec file counts | — |
| `npm run tag_tests` | Insert `// [UI/API/E2E Describe #N]` comments before each test() call | [docs/tag-tests.md](docs/tag-tests.md) |
| `npm run sync_registry` | Full reconciliation of all three registries against actual test results | [docs/test-registry.md](docs/test-registry.md) |
| `npm run update_registry` | Re-check only recorded broken/app-bug entries | [docs/test-registry.md](docs/test-registry.md) |
| `npm test` | Run all functional tests headless (Chromium) | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:all-browsers` | Run functional tests on Chromium + Firefox + WebKit | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:visual` | Run visual regression tests only (Chromium, `tests/visual/`) | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:update-snapshots` | Regenerate visual baseline screenshots after intentional UI changes | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:headed` | Run with browser visible (Chromium) | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:report` | Open the HTML test report | [docs/run-tests.md](docs/run-tests.md) |

---

## Recommended flow

```
Starting a new project:
  init_project / npm run init_project -- --name <name> --url <site>  → mcp-qa.config.json + scaffold
  → npm run audit_site -- --url <site>  → read site-audit-report.md
  → fill in pom/riskTiers from the report → generate_pom → generate_test

From a PRD:
  analyze_prd / npm run analyze_prd → review prd-tests.txt → npm run generate --file prd-tests.txt

New page, no POM yet:
  generate_pom → generate_test

Existing page:
  generate_test

Multi-page E2E journey:
  plan_e2e → review the checklist (reuse vs new methods) → generate_test

Something failed:
  investigate_and_fix / npm run fix

Registry out of sync:
  npm run sync_registry
```
