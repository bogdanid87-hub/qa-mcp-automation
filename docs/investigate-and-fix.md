# investigate\_and\_fix

Diagnoses a failing Playwright test, classifies the failure as a code bug or an
application bug, patches the code if it's fixable, saves a learned rule so the
same mistake doesn't recur, and re-runs to verify.

---

## Verdicts

The tool classifies every failure before spending any tokens on investigation.

**Transient pre-check** — before calling Claude, the tool re-runs the failing
spec(s) once:

| Original failure | Passes on retry | Verdict |
|---|---|---|
| Connection/navigation error (`net::ERR_*`, `Navigation failed`, 502/503) | yes | ⚡ **Transient** — app was temporarily unavailable; no code change |
| Locator/element timeout (`waiting for locator`, `toBeVisible`) | yes | 🌀 **Flaky** — timing or race condition; see below |
| Any failure | no | Proceeds to Claude investigation below |

**What to do with a 🌀 Flaky verdict:**

The tool doesn't modify test code — flakiness is not a code bug to fix, it's an instability
to manage. The right response depends on how often it flakes:

| Frequency | Action |
|---|---|
| Rare (< 5% of runs) | Add `retries: 1` to `playwright.config.ts` — one automatic retry absorbs occasional timing glitches without hiding real failures |
| Consistent (> 10% of runs) | The wait strategy is wrong. Find the specific element that's timing out and replace `waitForLoadState` or a hardcoded wait with `.waitFor({ state: 'visible' })` on that element |
| After a recent code change | The change probably introduced a race condition. Investigate the interaction between the new code and the test |

Retry config (conservative — catch real failures on second run):
```typescript
// playwright.config.ts
retries: process.env.CI ? 1 : 0,  // already set in this project
```

**What to do with a ⚡ Transient verdict:**

The app was temporarily unavailable — the test itself is correct. No action needed unless
it happens repeatedly, which would indicate infrastructure instability rather than a
test problem.

**Code bug** — the test logic is mechanically wrong: bad locator, wrong selector,
missing wait, incorrect import, wrong URL, timing issue. The test's *intention* is
correct but the *implementation* is broken.
→ The tool fixes the code, saves a lesson, and re-runs.

**App bug** — the test logic is correct and is asserting the right thing, but the
application under test behaves differently from what is expected. Example: a test
asserts that duplicate email registration is rejected, but the site accepts it anyway.
→ The tool does **not** touch the test. It writes a `/* ⚠️ APP BUG */` annotation
directly before the failing `test()` call and records the defect in the registry.

**Unclear** — not enough information to decide with confidence. No code is changed.

> A test that documents an application bug is correct and valuable — it proves the
> bug exists. Never change a test's assertions to make it pass.

---

## Objective preservation — intent-signature guard

A **Code bug** fix may change *how* a test reaches an assertion (locators,
waits, navigation, helper structure) but never *what* it asserts. Before
applying a proposed fix to a `tests/**/*.spec.ts` file, the tool computes an
"intent signature" for every `test(...)` (including `.skip`/`.only`/`.fixme`,
but not `test.describe(...)`) in both the current file and the proposed
replacement:

- For each `expect(...)` call, the signature captures everything chained
  *after* it — e.g. `.toBe(5)`, `.not.toBeVisible()`, `.toHaveText('foo')` —
  sorted for stable comparison.
- The `expect(...)` *subject* (the locator/value being checked) is
  deliberately excluded — that's the "how", and is exactly what a legitimate
  fix is allowed to change.

If any `test()` title that exists in both versions has a different signature
after the fix, the write is **refused** — same as a `safeWrite` rejection —
and added to `AutoFixResult.blockedWrites` with a `reason` showing the
before/after assertion lists and a `diff` of the proposed change. The fix
loop reports this as "⛔ Blocked writes — needs human review" (see
[conventions.md](conventions.md#safe-writes--srclibsafe-writets)) instead of
applying it.

A locator-only fix (same assertions, different selector/wait/navigation) is
**not** affected — its signature is unchanged, so it applies normally.

Tests dropped entirely (present before but not after) aren't reported here —
`safeWrite`'s drop-guard already refuses those writes.

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
npm run fix                                                   # run all tests, fix whatever fails
npm run fix -- --pattern tests/login.spec.ts                 # target one spec
npm run fix -- --output "Error: locator '#btn' ..."          # use pre-captured output
npm run fix -- --pattern tests/login.spec.ts --budget 0.50  # optional spending cap
npm run fix -- --pattern tests/login.spec.ts --max-attempts 3  # override attempt limit
```

The CLI tracks and displays cost after each attempt but never stops based on
cost alone. Two guards prevent runaway loops:

**`--max-attempts N`** (default: 5) — hard stop after N attempts regardless of
what the user answers at the retry prompt. When reached, the test is annotated
as BROKEN and the tool exits with a clear message. This is the primary guard
against a stuck problem that Claude can't resolve automatically.

**`--budget N`** — optional spending cap (useful for shared API keys with a usage
quota). Stops immediately when the cap is reached.

---

## Registry routing

The fix tool writes results to the correct registry based on the spec path:
- `tests/ui/` specs → `TESTS_UI.md`
- `tests/api/` specs → `TESTS_API.md`
- `tests/e2e/` specs → `TESTS_E2E.md`

## When `generate_test` auto-fix isn't enough

`generate_test` runs one auto-fix attempt automatically. If that doesn't resolve the
failure, it annotates the spec as `BROKEN` and stops. `investigate_and_fix` (or
`npm run fix`) is the deeper tool — it retries with full DOM and screenshot context
and can attempt multiple rounds until fixed or the optional spending cap is reached.
