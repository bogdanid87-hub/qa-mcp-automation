# Tool Reference

Quick index of all available tools. See the `docs/` folder for detailed usage guides.

---

## MCP tools (Claude Code chat)

| Tool | What it does | Doc |
|------|-------------|-----|
| `analyze_prd` | Read a PRD or feature description and generate a risk-prioritised test backlog in `prd-tests.txt` | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `generate_pom` | Inspect a live page and generate a locator-only POM file — run this before `generate_test` when starting on a new page | — |
| `generate_test` | Generate a complete Playwright test: POM + spec + auto-run + auto-fix + registry update | — |
| `inspect_page` | Navigate to a page headlessly and return all DOM elements with their best locator | — |
| `investigate_and_fix` | Diagnose a failing test (code bug vs app bug), patch the file, and save a learned rule | — |
| `run_tests` | Run the Playwright test suite and return the output | — |
| `list_resources` | List all existing page objects, fixtures, and spec files | — |

---

## Terminal commands

| Command | What it does |
|---------|-------------|
| `npm run analyze-prd` | CLI version of `analyze_prd` — supports PDF and image inputs |
| `npm run generate` | Generate a test from `my-test.txt` (or any batch `.txt` file) |
| `npm run fix` | Interactive fix loop for failing tests |
| `npm run sync-registry` | Full reconciliation of `TEST_CASES.md` against actual test results |
| `npm run update-registry` | Re-check only recorded broken/app-bug entries |
| `npm test` | Run all tests headless |
| `npm run test:headed` | Run with browser visible |
| `npm run test:report` | Open the HTML test report |

---

## Recommended flow

```
From a PRD:
  analyze_prd / npm run analyze-prd → review prd-tests.txt → npm run generate --file prd-tests.txt

New page, no POM yet:
  generate_pom → generate_test

Existing page:
  generate_test

Something failed:
  investigate_and_fix / npm run fix

Registry out of sync:
  npm run sync-registry
```
