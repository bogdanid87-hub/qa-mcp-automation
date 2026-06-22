# Tool Reference

**New here? You really only need the five _everyday_ tools below — the rest are optional.**
In Claude Code chat you mostly just say what you want in plain English (e.g. *"test the login
page"*, *"turn these requirements into tests"*) and the right tool runs. Full walkthrough:
[docs/getting-started.md](docs/getting-started.md); per-tool guides in [docs/](docs/).

---

## Everyday — the five you'll actually use

| Tool | What it does | Doc |
|------|-------------|-----|
| `generate_test` | Describe a test in plain English — it writes the test, runs it, fixes it if it fails the first time, and records the result. **The one you'll use most.** | [docs/generate-test.md](docs/generate-test.md) |
| `analyze_prd` | Turn a requirements doc or feature description into a prioritised to-do list of tests (skips anything already covered). | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `status` (`npm run status`) | *"Is everything OK?"* — a plain-English health summary of all your tests, ending with a bottom-line of what needs attention. | — |
| `investigate_and_fix` (`npm run fix`) | Something failed? Diagnoses and fixes it — and tells apart a real bug in the app from a bug in the test. | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `init_project` | Starting on a new site? Sets the project up (config + a ready-to-run scaffold) in one step. Run once. | [docs/init-project.md](docs/init-project.md) |

---

## Advanced — optional / power tools

| Tool | What it does | Doc |
|------|-------------|-----|
| `generate_auth_fixture` | Set up a reusable "logged-in" state so tests start signed in. Just give the login URL — the fields are auto-detected. | [docs/generate-auth-fixture.md](docs/generate-auth-fixture.md) |
| `generate_pom` | Prepare a reusable "page helper" (Page Object) for a page in advance. Optional — `generate_test` makes these for you. | [docs/generate-pom.md](docs/generate-pom.md) |
| `plan_e2e` | Preview a complex multi-page journey before generating it. `generate_test` does this internally. | [docs/plan-e2e.md](docs/plan-e2e.md) |
| `analyze_coverage` | Find gaps and risk areas in the tests you already have; writes a report (and optional ready-to-run list). | [docs/analyze-coverage.md](docs/analyze-coverage.md) |
| `generate_mock` | Fake a network response (e.g. a payment API like Stripe) or force an error/loading state. | [docs/generate-mock.md](docs/generate-mock.md) |
| `run_tests` | Run the existing tests (or one by name) and return results — no fixing, no file changes. | [docs/run-tests.md](docs/run-tests.md) |
| `inspect_page` | Diagnostic — list a page's elements and the best way to target each (for debugging "can't find the element"). | [docs/inspect-page.md](docs/inspect-page.md) |

---

## Maintenance — keep things tidy (mostly from the terminal)

| Command / tool | What it does | Doc |
|----------------|-------------|-----|
| `npm run update_registry` | **Quick** — re-runs ONLY the tests currently marked broken/app-bug, to see if any are now fixed (seconds). | [docs/test-registry.md](docs/test-registry.md) |
| `npm run sync_registry` | **Slow** — re-runs the whole suite to true-up every test catalog against reality. | [docs/test-registry.md](docs/test-registry.md) |
| `npm run audit_site` | Crawl a site and recommend a page-helper structure (and seed test data). | [docs/audit-site.md](docs/audit-site.md) |
| `generate_app_knowledge` (`npm run generate_knowledge`) | Gather known bugs/gaps/risk into one reference file the analysis tools read automatically. | [docs/generate-app-knowledge.md](docs/generate-app-knowledge.md) |
| `review_rules` (`npm run review_rules`) | Health-check the engine's saved lessons (stale + near-duplicate); `promote` makes one engine-wide. | [docs/review-rules.md](docs/review-rules.md) |
| `npm run tag_tests` | Re-add the catalog ID comments to test files after manual edits (`generate_test` does this automatically). | [docs/tag-tests.md](docs/tag-tests.md) |

---

## Everyday flows

```
Starting on a new site:
  init_project  →  (then just describe your first test)

From requirements:
  analyze_prd  →  review the suggested list  →  generate them

Day to day:
  "test the <feature>"   (generate_test)
  npm run status         (is everything OK?)
  npm run fix            (something failed)
```

---

## For developers — all terminal commands

| Command | What it does | Doc |
|---------|-------------|-----|
| `npm run generate` | Generate a test from `workspace/my-test.txt` (or any batch `.txt` file) | [docs/generate-test.md](docs/generate-test.md) |
| `npm run generate_api` | Shorthand for an API test — forces `type=api`, otherwise identical to `npm run generate` | [docs/generate-api-test.md](docs/generate-api-test.md) |
| `npm run generate_auth` | Auth fixture for form or OAuth login — fields auto-detected from the login page | [docs/generate-auth-fixture.md](docs/generate-auth-fixture.md) |
| `npm run generate_mock` | Network mock — fake a response for a URL | [docs/generate-mock.md](docs/generate-mock.md) |
| `npm run analyze_prd` | Requirements → prioritised test backlog (supports PDF/image inputs) | [docs/analyze-prd.md](docs/analyze-prd.md) |
| `npm run analyze_coverage` | Coverage gaps — scope by test file, folder, or catalog; optional URL | [docs/analyze-coverage.md](docs/analyze-coverage.md) |
| `npm run audit_site` | Crawl a site, recommend a page-helper structure, seed test data | [docs/audit-site.md](docs/audit-site.md) |
| `npm run init_project` | Set up a new project (config + runnable scaffold) | [docs/init-project.md](docs/init-project.md) |
| `npm run generate_knowledge` | Build `workspace/APP_KNOWLEDGE.md` from catalogs, backlog, coverage report | [docs/generate-app-knowledge.md](docs/generate-app-knowledge.md) |
| `npm run review_rules` | Saved-lesson hygiene report; `-- --promote <NNN>` makes a lesson engine-wide | [docs/review-rules.md](docs/review-rules.md) |
| `npm run fix` | Diagnose and fix failing tests | [docs/investigate-and-fix.md](docs/investigate-and-fix.md) |
| `npm run status` | Suite health at a glance | — |
| `npm run tag_tests` | Re-add catalog ID comments to test files | [docs/tag-tests.md](docs/tag-tests.md) |
| `npm run update_registry` | Quick re-check of only the broken/app-bug tests (seconds) | [docs/test-registry.md](docs/test-registry.md) |
| `npm run sync_registry` | Full re-run of the whole suite to true-up the catalogs (slow) | [docs/test-registry.md](docs/test-registry.md) |
| `npm test` | Run all functional tests headless (Chromium) | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:all-browsers` | Functional tests on Chromium + Firefox + WebKit | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:visual` | Visual regression tests only (Chromium, `tests/visual/`) | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:update-snapshots` | Regenerate visual baseline screenshots after intentional UI changes | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:headed` | Run with the browser visible (Chromium) | [docs/run-tests.md](docs/run-tests.md) |
| `npm run test:report` | Open the HTML test report | [docs/run-tests.md](docs/run-tests.md) |
