# Test Registry — TESTS\_UI.md, TESTS\_API.md, TESTS\_E2E.md

The project uses three registry files, automatically chosen based on the spec path:

| Spec location | Registry |
|---------------|---------|
| `tests/ui/` | `TESTS_UI.md` |
| `tests/api/` | `TESTS_API.md` |
| `tests/e2e/` | `TESTS_E2E.md` |

All three files share the same structure and are managed by the same tools. You should
rarely need to edit them by hand.

---

## Structure

Each registry has three sections:

**Passing tests** — numbered table, grouped by spec file and describe block:
```markdown
## tests/ui/cart.spec.ts

### Place Order: Add Products in Cart

| # | Test |
|---|------|
| 1 | should add two products to cart and verify prices, quantity and total |
```

**Application bugs** — tests that are correct but the site has a defect:
```markdown
| Risk | Spec | Describe | Test | Root cause | Actual behaviour |
|------|------|----------|------|------------|-----------------|
| critical | tests/ui/cart.spec.ts | ... | ... | ... | ... |
```

**Broken tests** — tests that failed and could not be auto-fixed:
```markdown
| Risk | Spec | Describe | Test | Root cause |
|------|------|----------|------|------------|
| low | tests/ui/contact.spec.ts | ... | ... | ... |
```

Risk values: `critical` · `high` · `medium` · `low`

---

## How it gets updated automatically

| Event | What gets recorded | Registry |
|-------|-------------------|---------|
| `generate_test` passes | Test added to passing table; spec tagged | Based on spec path |
| `generate_api_test` passes | Test added to passing table; spec tagged | `TESTS_API.md` |
| `generate_test` / `generate_api_test` detects app bug | Added to Application Bugs | Based on spec path |
| `generate_test` / `generate_api_test` cannot fix failure | Added to Broken Tests | Based on spec path |
| `investigate_and_fix` resolves a failure | Entry moved from Broken to passing | Based on spec path |
| `sync_registry` runs | Full reconciliation of all three registries | All three |
| `npm run tag_tests` | Inserts `// [UI/API/E2E #N]` comments into spec files | — |

Running `npm test` manually **never** touches any registry.

---

## sync_registry

Use this when the registry may be out of sync — after a server crash mid-generation,
after adding tests manually, or after fixing a broken test outside of the MCP tools.

```bash
npm run sync_registry
```

What it does in one pass:

1. **Adds undocumented passing tests** — tests that exist and pass but have no entry
2. **Promotes resolved broken/app-bug entries** — moves them back to passing
3. **Confirms regressions** — if a previously passing test now fails, it re-runs the
   spec once to rule out a transient failure (high traffic, network blip); only flags
   as broken if it fails twice in a row
4. **Records unrecorded failures** — failing tests with no entry anywhere get added
   to the Broken section; if the spec file already has an annotation comment
   (`/* ⚠️ APP BUG */` or `/* ⚠️ BROKEN */`), the correct classification and root
   cause are read from that comment
5. **Reports requirements-ledger drift** (when `REQUIREMENTS.md` has entries) — tests
   tagged `@req:REQ-...` with no matching `REQUIREMENTS.md` entry (a typo or a
   hand-edited ledger), and `REQUIREMENTS.md` entries with no covering test (the same
   "uncovered" list `analyze_coverage`/`npm run status` show). Informational only —
   `sync_registry` doesn't edit `REQUIREMENTS.md` or spec files; silently omitted when
   there's nothing to report

---

## update_registry

A faster, narrower version of `sync_registry`. Only re-runs specs that already have
entries in the Broken or Application Bugs sections — skips the full suite.

```bash
npm run update_registry
```

Use this when you've fixed a broken test or the site has been patched for a known
app bug and you want to check if the entries can be promoted to passing.

---

## Which one do I run? (`update_registry` vs `sync_registry`)

**Start with `update_registry` — the quick one.** It re-runs *only* the handful of tests
currently marked broken or app-bug, to see if any are now fixed (seconds, not minutes).
This is what you want most of the time — e.g. "did that app bug get fixed yet?"

Reach for **`sync_registry`** only when you need a full re-baseline: it re-runs the *whole*
suite to true-up every registry against reality (find newly-passing tests, catch
regressions in tests that used to pass, promote fixes). Thorough, but slow.

| | `update_registry` (quick) | `sync_registry` (full) |
|--|---------------------------|------------------------|
| What it re-runs | Only tests marked broken/app-bug | The whole suite |
| Speed | Fast (seconds) | Slow (minutes) |
| Promotes resolved broken/app-bug entries | ✓ | ✓ |
| Finds undocumented passing tests | ✗ | ✓ |
| Finds regressions in tests that used to pass | ✗ | ✓ |

**Rule of thumb:** after a targeted fix → `update_registry`. After bulk changes, a period
of inactivity, or when unsure → `sync_registry`.

---

## Fuzzy name matching

When a test name changes slightly between generation attempts (e.g. "place order" vs
"place an order"), the exact key lookup would fail to match the old broken entry with
the new passing test, leaving stale records.

Both tools normalise test names before comparing — stripping articles (`a`, `an`,
`the`), lowercasing, collapsing punctuation — so minor wording drift doesn't prevent
broken entries from being promoted.

**What normalisation does:**

| Original | Normalised |
|---|---|
| "should add a product to the cart" | "should add product cart" |
| "should add product to cart" | "should add product cart" |
| "Should Add Product To Cart" | "should add product cart" |

These all match each other.

**What normalisation does NOT handle:**

Semantic rewrites — renaming a test to describe a different intent:

| Old name | New name | Result |
|---|---|---|
| "should verify cart totals" | "should confirm cart totals" | ✅ Match — same words, different verb |
| "should reject duplicate email" | "should accept duplicate email" | ❌ No match — "reject" vs "accept" |
| "should add product to cart" | "should remove product from cart" | ❌ No match — fundamentally different test |

If a broken entry doesn't promote after a test passes, the names may have drifted too far
for fuzzy matching to bridge. Check `npm run tag_tests` — it warns when a registry name
doesn't appear verbatim in the spec file (the most reliable sign of a name mismatch).

---

## Manual cleanup after annotation

When a broken or app-bug test is fixed and `sync_registry` promotes it, the
`/* ⚠️ BROKEN */` or `/* ⚠️ APP BUG */` comment in the spec file is **not**
removed automatically. Remove it manually after the entry leaves the broken section.
