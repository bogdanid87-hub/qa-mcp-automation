# investigate\_and\_fix

Diagnoses a failing Playwright test, classifies the failure as a code bug or an
application bug, patches the code if it's fixable, saves a learned rule so the
same mistake doesn't recur, and re-runs to verify.

---

## Code bug vs app bug

This distinction is the core of what the tool does.

**Code bug** — the test logic is mechanically wrong: bad locator, wrong selector,
missing wait, incorrect import, wrong URL, timing issue. The test's *intention* is
correct but the *implementation* is broken.
→ The tool fixes the code, saves a lesson, and re-runs.

**App bug** — the test logic is correct and is asserting the right thing, but the
application under test behaves differently from what is expected. Example: a test
asserts that duplicate email registration is rejected, but the site accepts it anyway.
→ The tool does **not** touch the test. It writes a `/* ⚠️ APP BUG */` annotation
directly before the failing `test()` call and records the defect in `TEST_CASES.md`.

> A test that documents an application bug is correct and valuable — it proves the
> bug exists. Never change a test's assertions to make it pass.

---

## What the tool sees

Beyond just the failure output text, the tool automatically gathers:

- **Screenshot** — Playwright saves a `test-failed-1.png` on every failure; Claude
  receives this image and can see what was actually on screen at the point of failure
- **Live DOM snapshot** — when the failure looks like a locator timeout, the tool
  re-inspects the failing page and includes the current DOM elements so Claude can
  identify the correct selector

This is why the tool can fix wrong locators reliably — it doesn't guess from source
code alone, it sees the real page.

---

## Learned rules

After every successful fix, the lesson is written to `src/prompts/learned-rules.md`
in this format:

```markdown
## Rule 008 — Mismatched import style causes undefined class

**Problem class**: Using `import X from` (default) instead of `import { X } from`
(named) when the module uses a named export causes the imported value to be undefined.

**Rule**: Always match the import style to the export style.
```

These rules are automatically injected into the system prompt for every subsequent
`generate_test` call, so the same mistake is never repeated in newly generated code.

---

## Annotations written to spec files

When a test can't be fixed, a comment is written directly before the `test()` call:

**Broken test** (code issue, fix budget exhausted):
```typescript
/* ⚠️  BROKEN — failed and could not be auto-fixed.
 * Root cause: The locator '[data-qa="place-order-button"]' does not exist on the page.
 * Fix manually or run: npm run fix */
test('should place an order', async ({ ... }) => {
```

**Application bug** (correct test, broken site):
```typescript
/* ⚠️  APP BUG — This test is correct; the application under test has a defect.
 * Expected behaviour: Quantity input field exists on the cart page.
 * Actual behaviour:   The cart renders quantity as a read-only button, not an input.
 * Do NOT change this test — it documents a real bug. Fix the application instead. */
test('should update quantity in cart', async ({ ... }) => {
```

---

## Usage

### From Claude Code

```
Investigate and fix this failure:
[paste Playwright output]

Investigate and fix the failures in tests/login.spec.ts
```

Leaving `test_output` empty runs all tests automatically first.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `test_output` | no | Playwright failure output to diagnose |
| `pattern` | no | Test file to run if no output is provided |

### From the terminal

```bash
npm run fix                                              # run all tests, fix whatever fails
npm run fix -- --pattern tests/login.spec.ts            # target one spec
npm run fix -- --output "Error: locator '#btn' ..."     # use pre-captured output
```

The CLI enters an interactive loop: each fix attempt shows the running token cost,
and when the $0.30 budget is reached you're asked whether to continue.

---

## Registry routing

The fix tool writes results to the correct registry based on the spec path:
- `tests/api/` specs → `TEST_API.md`
- `tests/ui/` and `tests/e2e/` specs → `TEST_CASES.md`

## When `generate_test` auto-fix isn't enough

`generate_test` runs one auto-fix attempt automatically. If that doesn't resolve the
failure, it annotates the spec as `BROKEN` and stops. `investigate_and_fix` (or
`npm run fix`) is the deeper tool — it retries with full DOM and screenshot context
and can attempt multiple rounds until fixed or budget is exhausted.
