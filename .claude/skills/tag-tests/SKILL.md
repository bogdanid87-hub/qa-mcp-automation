---
name: tag-tests
description: Inserts registry-ID comments (e.g. "[UI Cart #3]") before each test() linking it to TESTS_UI/API/E2E.md (npm run tag_tests). Load when running tag_tests, interpreting its warnings, or checking the spec tagging ratio.
---

# tag_tests

Inserts a short registry ID comment before every `test()` call in all spec files,
linking each test back to its entry in `TESTS_UI.md`, `TESTS_API.md`, or
`TESTS_E2E.md`.

```typescript
// [UI Cart #3]
test('should remove a product from the cart and update the cart', async ({ page }) => {
```

Format: `[<Registry> <Describe> #<N>]` — Registry is `UI`/`API`/`E2E` based on the
spec's folder, Describe is the `test.describe()` block name (shortened if long), N
is the test's position within its describe section in the registry.

## Usage

```bash
npm run tag_tests
```

No arguments. Reads all three registries and tags every spec file with registered
tests. Safe to run repeatedly — correct existing tags are left untouched.

```
🏷️  Tagging tests with registry IDs...

  [UI]  tests/ui/cart.spec.ts — +3 added
  [API] tests/api/auth.spec.ts — ~1 updated

════════════════════════════════════════════════
  Done: 3 added, 1 updated, 27 already correct
  1 warning — see above
════════════════════════════════════════════════
```

## Warnings — name mismatches

```
⚠️  [API] tests/api/products.spec.ts — test name not found in file:
    "should return no matching products for non-existent search term"
```

| Cause | What to do |
|-------|-----------|
| Test was renamed | Update the registry entry name manually, then re-run `tag_tests` |
| Test was deleted | Remove the registry entry manually |
| Duplicate entry from a rename (old + new name both in registry) | Remove the stale old-name row |

`sync_registry` does **not** fix these — it only detects orphaned spec *files*,
not orphaned test *names* within a file. This warning is currently the only
surface for name mismatches.

## When it runs automatically

After `generate_test` or `generate_api_test` records a new passing test — tags are
written immediately, no manual run needed for generated tests.

Run manually after: editing a test name directly in a spec file, manually adding a
test to a registry, or running `sync_registry`/`update_registry`.

## What the tag is used for

`npm run status` reads these tags to report the tagging ratio:

```
⚠️  Spec tagging: 8/30 tests tagged
     Run: npm run tag_tests
```

A low ratio means some registered tests are hard to navigate to from the registry,
and may indicate incomplete cleanup after a spec edit.

Full guide: [docs/tag-tests.md](../../../docs/tag-tests.md)
