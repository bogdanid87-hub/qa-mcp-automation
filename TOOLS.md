# Tool Reference

Quick index of all available tools. New here? Start with [docs/getting-started.md](docs/getting-started.md).
Detailed per-tool guides are in the `docs/` folder. Project naming and architecture decisions: [docs/conventions.md](docs/conventions.md).

---

## MCP tools (Claude Code chat)

| Tool | What it does | Doc |
|------|-------------|-----|
| `analyze_prd` | Read a PRD or feature description and generate a risk-prioritised test backlog in `prd-tests.txt` | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `generate_pom` | Inspect a live page and generate a locator-only POM file — run this before `generate_test` when starting on a new page | [docs/generate-pom.md](docs/generate-pom.md) |
| `generate_api_test` | Generate a Playwright API test (request fixture, no browser) — local LLM first, records to TEST_API.md | [docs/generate-api-test.md](docs/generate-api-test.md) |
| `generate_test` | Generate a complete Playwright UI/E2E test: POM + spec + auto-run + auto-fix + registry update | [docs/generate-test.md](docs/generate-test.md) |
| `inspect_page` | Navigate to a page headlessly and return all DOM elements with their best locator | [docs/inspect-page.md](docs/inspect-page.md) |
| `investigate_and_fix` | Diagnose a failing test (code bug vs app bug), patch the file, and save a learned rule | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `run_tests` | Run the Playwright test suite and return the output | [docs/run-tests.md](docs/run-tests.md) |
| `list_resources` | List all existing page objects, fixtures, and spec files | [docs/list-resources.md](docs/list-resources.md) |

---

## Terminal commands

| Command | What it does | Doc |
|---------|-------------|-----|
| `npm run analyze_prd` | CLI version of `analyze_prd` — supports PDF and image inputs | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `npm run generate` | Generate a test from `my-test.txt` (or any batch `.txt` file) | [docs/generate-test.md](docs/generate-test.md) |
| `npm run fix` | Interactive fix loop for failing tests | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `npm run sync_registry` | Full reconciliation of `TEST_CASES.md` against actual test results | [docs/test-registry.md](docs/test-registry.md) |
| `npm run update_registry` | Re-check only recorded broken/app-bug entries | [docs/test-registry.md](docs/test-registry.md) |
| `npm test` | Run all tests headless | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:headed` | Run with browser visible | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:report` | Open the HTML test report | [docs/run-tests.md](docs/run-tests.md) |

---

## Recommended flow

```
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
