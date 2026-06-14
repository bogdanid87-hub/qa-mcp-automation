---
name: investigate-and-fix
description: Diagnoses a failing Playwright test (transient/flaky/code bug/app bug), patches code with screenshot+DOM context, saves a learned rule, and re-runs (investigate_and_fix MCP tool / npm run fix). Load when a test fails, or interpreting BROKEN/APP BUG annotations.
---

# investigate_and_fix

Diagnoses a failing Playwright test, classifies the failure, patches the code if
fixable, saves a learned rule so the mistake doesn't recur, and re-runs to verify.

## Verdicts

Before spending tokens, the tool re-runs the failing spec once (transient
pre-check):

| Original failure | Passes on retry | Verdict |
|---|---|---|
| Connection/navigation error (`net::ERR_*`, `Navigation failed`, 502/503) | yes | ⚡ **Transient** — app was temporarily unavailable, no code change |
| Locator/element timeout (`waiting for locator`, `toBeVisible`) | yes | 🌀 **Flaky** — timing/race condition, see below |
| Any failure | no | Proceeds to Claude investigation |

**🌀 Flaky** — not fixed automatically; the response depends on frequency:

| Frequency | Action |
|---|---|
| Rare (< 5%) | `retries: 1` in `playwright.config.ts` absorbs occasional glitches |
| Consistent (> 10%) | Wait strategy is wrong — replace `waitForLoadState`/hardcoded waits with `.waitFor({ state: 'visible' })` on the specific element |
| After a recent code change | Likely a new race condition — investigate the interaction |

**⚡ Transient** — no action needed unless it recurs (would indicate
infrastructure instability, not a test problem).

**Code bug** — test *intention* correct, *implementation* mechanically wrong (bad
locator, missing wait, wrong import, wrong URL, timing). Tool fixes the code,
saves a lesson, re-runs.

**App bug** — test logic and assertion are correct; the *application* behaves
differently than expected. Tool does NOT touch the test — writes `/* ⚠️ APP BUG
*/` before the `test()` call and records the defect in the registry. A test
documenting a real bug is correct and valuable — never change its assertions to
make it pass.

**Unclear** — not enough information; no code changed.

## Objective preservation — intent-signature guard

A code-bug fix may change *how* a test reaches an assertion (locators, waits,
navigation, helpers) but never *what* it asserts. For every `test(...)` (including
`.skip`/`.only`/`.fixme`) present in both the current and proposed file, the tool
computes a signature from everything chained after each `expect(...)` (e.g.
`.toBe(5)`, `.toHaveText('foo')`, sorted) — the `expect(...)` *subject* is
excluded, since changing the locator/value being checked is exactly what a
legitimate fix does.

If any shared test's signature differs after the fix, the write is **refused**
(same as a `safeWrite` rejection) and added to `AutoFixResult.blockedWrites` with
a `reason` (before/after assertions) and `diff` — surfaced as "⛔ Blocked writes —
needs human review". A locator-only fix (same assertions) is unaffected. Tests
dropped entirely are caught by `safeWrite`'s drop-guard separately. See
[docs/conventions.md](../../../docs/conventions.md#safe-writes--srclibsafe-writets).

## What the tool sees

- **Screenshot** — `test-failed-1.png`, sent to Claude as an image
- **Live DOM snapshot** — for locator-timeout failures, the page is re-inspected
  so Claude can identify the correct selector from the real page, not source code
  alone

## Learned rules

After every successful fix, a lesson is appended to
[`learned-rules.md`](../learned-rules-loader/SKILL.md):

```markdown
## Rule 008 — Mismatched import style causes undefined class
**Problem class**: Using `import X from` (default) instead of `import { X } from`
(named) when the module uses a named export causes the imported value to be undefined.
**Rule**: Always match the import style to the export style.
```

Injected into the system prompt for every subsequent `generate_test` call.

## Annotations written to spec files

**Broken** (code issue, fix budget exhausted):
```typescript
/* ⚠️  BROKEN — failed and could not be auto-fixed.
 * Root cause: The locator '[data-qa="place-order-button"]' does not exist on the page.
 * Fix manually or run: npm run fix */
test('should place an order', async ({ ... }) => {
```

**App bug** (correct test, broken site):
```typescript
/* ⚠️  APP BUG — This test is correct; the application under test has a defect.
 * Expected behaviour: ...
 * Actual behaviour:   ...
 * Do NOT change this test — it documents a real bug. Fix the application instead. */
test('should update quantity in cart', async ({ ... }) => {
```

## Usage

```
Investigate and fix this failure:
[paste Playwright output]

Investigate and fix the failures in tests/login.spec.ts
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `test_output` | no | Playwright failure output to diagnose — leave empty to run all tests first |
| `pattern` | no | Test file to run if no output is provided |

```bash
npm run fix                                                    # run all, fix whatever fails
npm run fix -- --pattern tests/login.spec.ts                  # target one spec
npm run fix -- --output "Error: locator '#btn' ..."           # pre-captured output
npm run fix -- --pattern tests/login.spec.ts --budget 0.50    # spending cap
npm run fix -- --pattern tests/login.spec.ts --max-attempts 3 # override attempt limit
```

## Loop & cost ceilings

Three guards, any of which annotates `BROKEN` and stops:

- **`--max-attempts N`** (default 5) — hard stop regardless of retry-prompt answers
- **`--budget N`** — before each attempt, cost is estimated (system prompt +
  context + failure output + ~1500 tokens/screenshot); the call is **aborted
  before sending** if a worst-case estimate would exceed the cap. (Generation
  calls in `generate_test` use the same estimate but only warn, since aborting
  mid-generation wastes tokens already spent.)
- **No-progress detector** — each attempt computes a failure signature (sorted
  failing `spec › test` names + normalized error lines, durations/paths
  stripped). If re-verification produces the same signature, the loop stops
  immediately — the previous fix had no effect.

## Registry routing

`tests/ui/` → `TESTS_UI.md`, `tests/api/` → `TESTS_API.md`, `tests/e2e/` →
`TESTS_E2E.md`.

## vs generate_test's auto-fix

[generate-test](../generate-test/SKILL.md) runs ONE auto-fix attempt
automatically; if that fails it annotates `BROKEN` and stops. `investigate_and_fix`
/ `npm run fix` is the deeper tool — full DOM + screenshot context, multiple
rounds, default 5 attempts.

Full guide: [docs/investigate-and-fix.md](../../../docs/investigate-and-fix.md)
