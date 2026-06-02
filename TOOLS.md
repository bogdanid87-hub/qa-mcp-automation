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
| `generate_api_test` | Generate a Playwright API test (request fixture, no browser) — local LLM first, records to TESTS_API.md | [docs/generate-api-test.md](docs/generate-api-test.md) |
| `generate_test` | Generate a complete Playwright UI/E2E test: POM + spec + auto-run + auto-fix + registry update | [docs/generate-test.md](docs/generate-test.md) |
| `inspect_page` | Navigate to a page headlessly and return all DOM elements with their best locator | [docs/inspect-page.md](docs/inspect-page.md) |
| `investigate_and_fix` | Diagnose a failing test (code bug vs app bug), patch the file, and save a learned rule | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `run_tests` | Run tests and return output — target a file with `pattern`, or a single test by name with `grep` | [docs/run-tests.md](docs/run-tests.md) |
| `list_resources` | List all existing page objects, fixtures, and spec files | [docs/list-resources.md](docs/list-resources.md) |
| `generate_auth_fixture` | Generate a Playwright auth fixture for form or OAuth login — saves browser storage state and adds a named fixture | [docs/generate-auth-fixture.md](docs/generate-auth-fixture.md) |
| `generate_mock` | Generate a `page.route()` network mock — intercepts a URL and returns a controlled response | [docs/generate-mock.md](docs/generate-mock.md) |

---

## Terminal commands

| Command | What it does | Doc |
|---------|-------------|-----|
| `npm run analyze_coverage` | CLI version of `analyze_coverage` — scope by spec, folder, or registry; optional URL | [docs/analyze-coverage.md](docs/analyze-coverage.md) |
| `npm run analyze_prd` | CLI version of `analyze_prd` — supports PDF and image inputs | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `npm run generate_api` | CLI version of `generate_api_test` — inline description or file | [docs/generate-api-test.md](docs/generate-api-test.md) |
| `npm run generate_auth` | Generate a Playwright auth fixture for form or OAuth login — saves storage state and adds a named fixture | [docs/generate-auth-fixture.md](docs/generate-auth-fixture.md) |
| `npm run generate_mock` | Generate a `page.route()` network mock — intercepts a URL and returns a controlled response | [docs/generate-mock.md](docs/generate-mock.md) |
| `npm run audit_site` | Crawl a site, build a page-type × UI-component matrix, and recommend a POM hierarchy | [docs/audit-site.md](docs/audit-site.md) |
| `npm run generate` | Generate a test from `my-test.txt` (or any batch `.txt` file) | [docs/generate-test.md](docs/generate-test.md) |
| `npm run fix` | Interactive fix loop for failing tests | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `npm run status` | Suite health at a glance: registry counts, tagging ratio, open backlog gaps, spec file counts | — |
| `npm run tag_tests` | Insert `// [UI/API/E2E Describe #N]` comments before each test() call | [docs/tag-tests.md](docs/tag-tests.md) |
| `npm run sync_registry` | Full reconciliation of all three registries against actual test results | [docs/test-registry.md](docs/test-registry.md) |
| `npm run update_registry` | Re-check only recorded broken/app-bug entries | [docs/test-registry.md](docs/test-registry.md) |
| `npm test` | Run all tests headless | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:headed` | Run with browser visible | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:report` | Open the HTML test report | [docs/run-tests.md](docs/run-tests.md) |

---

## Recommended flow

```
Starting a new project:
  npm run audit_site -- --url <site>  → read site-audit-report.md
  → design POM hierarchy → write base classes → update system prompt
  → then generate tests

From a PRD:
  analyze_prd / npm run analyze_prd → review prd-tests.txt → npm run generate --file prd-tests.txt

New page, no POM yet:
  generate_pom → generate_test

Existing page:
  generate_test

Something failed:
  investigate_and_fix / npm run fix

Registry out of sync:
  npm run sync_registry
```
