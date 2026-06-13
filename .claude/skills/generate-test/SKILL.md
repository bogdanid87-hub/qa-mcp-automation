---
name: generate-test
description: Generates a UI/API/E2E Playwright test from a description — POM + spec + auto-run + auto-fix + registry (generate_test MCP tool / npm run generate). The single most-used tool. Load when generating, extending, or planning a test.
---

# generate_test

Generates a Playwright test — UI, API, E2E, or mixed — from a plain-English
description. Type is auto-detected: UI/E2E (navigation, forms, DOM), API
(endpoint/HTTP method or `tests/api/` spec_file), or mixed (API setup → UI flow →
API verify).

## What happens when you call it

1. **Similarity check** — compares your description against every existing test
   in `TESTS_UI.md`, warns if the scenario is already covered
2. **POM step** — if no POM exists for this feature, one is generated and
   committed to disk before the spec is written
3. **Spec step** — Claude writes the spec using the POM already on disk
4. **Auto-run** — the new spec executes immediately
5. **Auto-fix** — on failure, Claude diagnoses, patches, saves a learned rule, and
   re-runs; if still failing, you're prompted to retry
6. **Registry** — passing tests recorded in `TESTS_UI.md`/`TESTS_API.md`/`TESTS_E2E.md`;
   unresolvable failures annotated in the spec (`⚠️ APP BUG` or `⚠️ BROKEN`)

## POM generation routing

| Scenario | POM step | Spec step |
|----------|----------|-----------|
| POM already exists | skipped | Claude API |
| New POM, simple flow (≤ 2 page paths) | Local LLM → Claude fallback | Claude API |
| New POM, complex flow (> 2 page paths) | Claude plans → Local LLM builds in parallel → Claude fills gaps | Claude API |

## MCP usage

```
Generate a test for the contact us form
Generate a test for the login flow — page_paths: /login
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `description` | yes | Test steps or description of what to test |
| `test_name` | no | Names `test()`/`describe()` — not the filename |
| `spec_file` | no | Target spec, e.g. `"tests/ui/auth.spec.ts"` |
| `page_paths` | no (recommended) | Pages to inspect live for accurate locators |
| `dry_run` | no | `true` = generate code but don't write/run — preview only |

**Always provide `page_paths`** when known — without it, locators are invented
rather than extracted from the real DOM. For 3+ page flows, run `generate_pom` on
all pages first (see [generate-pom](../generate-pom/SKILL.md)).

**Use `dry_run: true`** to review the target file path and code before committing
tokens to the auto-fix loop — recommended for any page without an existing POM.

## Terminal usage — my-test.txt

```
# test_name: login-happy-path       ← names test()/describe()
# spec_file: tests/ui/auth.spec.ts  ← target file (created/appended)
# page_paths: /login, /             ← pages to inspect live

Test the login flow with valid credentials.
1. Navigate to the login page
...
```

```bash
npm run generate -- --file my-test.txt
```

Batch mode: separate blocks with `---` on its own line; the token budget
accumulates across the batch. If the budget is reached mid-batch, remaining tests
are skipped (not queued) — completed ones are fully written and registered. Split
large files into 3-4 tests per batch.

Inline (no file): `npm run generate -- --description "..." --page_paths /login`

## Auto-fix loop

On first-run failure: reads the screenshot + live DOM, classifies **code bug**
(patch + learned rule + re-run) vs **app bug** (`/* ⚠️ APP BUG */` annotation, spec
left unmodified — it correctly documents a defect).

Stops after 2 attempts by default (`--max-attempts N` to override), on user
decline, on `--budget N`, or on no-progress — writes `/* ⚠️ BROKEN */` in all stop
cases. Separate from `npm run fix`'s loop (default 5 attempts) — see
[investigate-and-fix](../investigate-and-fix/SKILL.md).

## Additional test proposals

After the main test, the tool proposes further scenarios (negative/edge/boundary
cases, alternative happy paths) not yet covered — filtered against `TESTS_UI.md` so
only genuinely new suggestions appear. Per
[qa-workflow](../qa-workflow/SKILL.md#generate_test-follow-up), present these as a
numbered list and let the user pick/modify before calling again.

## Token cost

No default cap — generation and the fix loop run to completion, cost tracked from
actual API usage. `--max-attempts N` (default 2) caps fix retries; `--budget N`
caps total spend — fix attempts abort *before* an over-budget call, generation
calls only warn and continue (a partial POM/spec is still progress). Per
[qa-workflow](../qa-workflow/SKILL.md), notify the user and get permission before
running this.

## Registry recording

| Spec location | Registry |
|---------------|---------|
| `tests/ui/` | `TESTS_UI.md` |
| `tests/api/` | `TESTS_API.md` |
| `tests/e2e/` | `TESTS_E2E.md` |

Pass → passing table (sequential number). App bug → `⚠️ Application Bugs` section
with root cause + actual behaviour. Unfixable → `❌ Broken Tests` section with root
cause. Out of sync → `npm run sync_registry`.

## Locator uniqueness

POM locators written during this step must be unique on the page — a selector that
matches >1 element passes silently until the spec runs in strict mode. This is the
category behind Rules 002–005/024/025 ("shared CSS class → strict-mode violation"):
Bootstrap reuses `.active`, `.alert`, `.alert-success`, `.item` across unrelated
regions (carousel slide vs. indicator, a form's success alert vs. the footer
subscription alert).

Before finalizing any class-based locator:
- Apply [qa-conventions](../qa-conventions/SKILL.md#locators)'s "compound class can
  still collide" rule — scope to a unique ancestor (`#review-form
  .alert-success.alert`, not `.alert-success.alert`).
- `generate_pom`'s [locator validation](../generate-pom/SKILL.md#locator-validation)
  step (`.count()` against the live page) catches `page.locator()` selectors that
  resolve to 0 or >1 — fix any ⚠️/❌ before running `generate_test`.
- `generate_test` itself runs the same collision check automatically as part of its
  pre-write reviewer pass (Task Group 8) — a bare/compound class locator with >1
  match on the inspected `page_paths` DOM is reported in "⚠️ Review notes". The
  reviewer also flags forwarding-alias POM methods (near-duplicate name, same
  param count/return type as a method on another POM class) and `new SomePage(page)`
  in specs. Report-only — see [Review notes](../../../docs/generate-test.md#review-notes).

Full guide: [docs/generate-test.md](../../../docs/generate-test.md)
