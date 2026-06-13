---
name: run-tests
description: Runs the Playwright suite and reports results (run_tests MCP tool / npm test) — pattern, grep, and browser params for targeting one file or one test. Load when running or debugging tests.
---

# run_tests

Runs the Playwright test suite and returns the output. This tool only executes and
reports — it never modifies `TESTS_UI.md` or any source files.

## Usage

```
Run the tests
Run tests matching tests/cart.spec.ts
Run the test called "should add two products to cart"
Run only the empty cart test in tests/ui/cart.spec.ts
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `pattern` | no | File path or glob — e.g. `"tests/ui/cart.spec.ts"` or `"tests/api/"` |
| `grep` | no | Filter by test name; combine with `pattern` to target one test in one file |
| `browser` | no | `chromium` (default), `firefox`, `webkit`, or `visual` |

Running one test by `pattern` + `grep` is far faster than running the whole spec.

## From the terminal

```bash
npm test                        # all tests, headless Chromium
npm run test:headed             # browser visible — useful for debugging
npm run test:debug              # Playwright Inspector — step through actions
npm run test:report             # open the HTML report from the last run

npx playwright test tests/ui/cart.spec.ts --project=chromium                     # whole file
npx playwright test tests/ui/cart.spec.ts --grep "should add" --project=chromium # one test
npx playwright test --grep "should add two products" --project=chromium          # by name, all files
```

This is the command [qa-workflow](../qa-workflow/SKILL.md) requires before
committing any edit to `tests/`, `pages/`, `fixtures/`, or `src/prompts/`.

## Reading the output

```
✓  1 [chromium] › tests/login.spec.ts:5:7 › Login › should login with valid credentials (3.2s)
✗  2 [chromium] › tests/cart.spec.ts:12:7 › Cart › should add two products (timeout)

1 failed, 1 passed
```

Path after `›` is `spec file › describe block › test name`. Screenshots/videos on
failure go to `test-results/`; `npm run test:report` gives a visual breakdown.

## Parallel execution

`fullyParallel: true` — each test gets its own isolated browser context. Local
worker count is `cpus / 2` (Playwright default); CI uses 2 explicitly. Every
generated test must be fully independent (sets up its own preconditions, no
shared state) — this is what makes parallelism safe.

```bash
npx playwright test --workers=4   # override locally if the site handles it
npx playwright test --workers=1   # force serial — useful for debugging one failure
```

## run_tests vs sync_registry

Running tests manually never touches `TESTS_UI.md`/`TESTS_API.md`/`TESTS_E2E.md`.
To reconcile the registries with actual results afterwards: `npm run sync_registry`
(see [docs/test-registry.md](../../../docs/test-registry.md)).

Full guide: [docs/run-tests.md](../../../docs/run-tests.md)
