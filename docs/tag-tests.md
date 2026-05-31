# tag\_tests

Inserts a short registry ID comment before every `test()` call in all spec files,
linking each test back to its entry in `TESTS_UI.md`, `TESTS_API.md`, or
`TESTS_E2E.md`.

---

## What a tag looks like

```typescript
// [UI Cart #3]
test('should remove a product from the cart and update the cart', async ({ page }) => {
```

The format is `[<Registry> <Describe> #<N>]` where:
- **Registry** — `UI`, `API`, or `E2E` based on the spec's folder
- **Describe** — the `test.describe()` block name (shortened if long)
- **N** — the test's position number within its describe section in the registry

---

## Usage

```bash
npm run tag_tests
```

No arguments needed. The tool reads all three registries and tags every spec file
that has registered tests. It is safe to run repeatedly — existing correct tags are
left untouched.

---

## Output

```
🏷️  Tagging tests with registry IDs...

  [UI]  tests/ui/cart.spec.ts — +3 added
  [API] tests/api/auth.spec.ts — ~1 updated

════════════════════════════════════════════════
  Done: 3 added, 1 updated, 27 already correct
  1 warning — see above
════════════════════════════════════════════════
```

- **added** — tag written for the first time
- **updated** — tag already existed but number or describe changed (e.g. after a registry edit)
- **already correct** — tag present and matches; file not touched

---

## Warnings

```
⚠️  [API] tests/api/products.spec.ts — test name not found in file:
    "should return no matching products for non-existent search term"
    (test may have been renamed — run sync_registry)
```

This means the registry has an entry whose name does not appear verbatim in the spec
file. Common causes:

| Cause | What to do |
|-------|-----------|
| Test was renamed | Update the registry entry name manually, then re-run `tag_tests` |
| Test was deleted | Remove the registry entry manually |
| Duplicate entry from a rename (old name + new name both in registry) | Remove the stale old-name row |

`sync_registry` **will not** fix these automatically — it only detects orphaned spec
*files*, not orphaned test *names* within a file. The warning from `tag_tests` is
currently the only tool that surfaces name mismatches.

---

## When it runs automatically

`tag_tests` is called automatically after:
- `generate_test` records a new passing test
- `generate_api_test` records a new passing test

So for generated tests, tags are written immediately without needing a manual run.
Run `npm run tag_tests` manually after:
- Editing a test name directly in a spec file
- Manually adding a test to a registry
- Running `sync_registry` or `update_registry`

---

## What the tag is used for

The `npm run status` command reads these tags to report the **tagging ratio** — how
many registered tests have a tag comment in their spec file:

```
⚠️  Spec tagging: 8/30 tests tagged
     Run: npm run tag_tests
```

A low ratio means some registered tests are hard to navigate back to from the
registry. The tags also serve as a lightweight audit trail: if a tag comment is
present but the registry entry is gone, the spec was likely cleaned up incompletely.
