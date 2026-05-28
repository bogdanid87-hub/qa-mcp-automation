# run\_tests

Runs the Playwright test suite and returns the output. This tool only executes and
reports — it never modifies `TEST_CASES.md` or any source files.

---

## From Claude Code

```
Run the tests
Run tests matching tests/cart.spec.ts
Run tests matching tests/login
```

### Parameter

| Parameter | Required | Description |
|-----------|----------|-------------|
| `pattern` | no | File path or partial name to filter which tests run |

---

## From the terminal

```bash
npm test                        # all tests, headless Chromium
npm run test:headed             # browser visible — useful for debugging
npm run test:debug              # Playwright Inspector — step through test actions
npm run test:report             # open the HTML report from the last run
```

Targeting a specific file or pattern:
```bash
npx playwright test tests/cart.spec.ts --project=chromium
npx playwright test --grep "should add" --project=chromium
```

---

## Reading the output

```
✓  1 [chromium] › tests/login.spec.ts:5:7 › Login › should login with valid credentials (3.2s)
✗  2 [chromium] › tests/cart.spec.ts:12:7 › Cart › should add two products (timeout)

1 failed, 1 passed
```

- `✓` — passed
- `✗` — failed
- The path after `›` is `spec file › describe block › test name`

Screenshots and videos are saved to `test-results/` on failure. The HTML report
(`npm run test:report`) gives a visual breakdown with timeline, screenshots, and
error details.

---

## Run tests vs sync-registry

Running tests manually never touches `TEST_CASES.md` or `TEST_API.md`. If you want
the registries updated after a manual run, use:

```bash
npm run sync_registry    # reconcile TEST_CASES.md with actual results
```

See [docs/test-registry.md](test-registry.md) for details.
