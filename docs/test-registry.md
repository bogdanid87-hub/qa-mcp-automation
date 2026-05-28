# Test Registry — TEST\_CASES.md and TEST\_API.md

The project uses two registry files, automatically chosen based on the spec path:

| Spec location | Registry |
|---------------|---------|
| `tests/ui/` and `tests/e2e/` | `TEST_CASES.md` |
| `tests/api/` | `TEST_API.md` |

Both files have the same structure and are managed by the same tools. You should
rarely need to edit either by hand.

---

## Structure

The file has three sections:

**Passing tests** — numbered table, one row per test:
```markdown
| # | Test |
|---|------|
| 1 | should submit the contact form and show success message |
```

**Application bugs** — tests that are correct but the site has a defect:
```markdown
| Spec | Describe | Test | Root cause | Actual behaviour |
```

**Broken tests** — tests that failed and could not be auto-fixed:
```markdown
| Spec | Describe | Test | Root cause |
```

---

## How it gets updated automatically

| Event | What gets recorded | Registry |
|-------|-------------------|---------|
| `generate_test` passes | Test added to passing table | Based on spec path |
| `generate_api_test` passes | Test added to passing table | `TEST_API.md` |
| `generate_test` / `generate_api_test` detects an app bug | Added to Application Bugs | Based on spec path |
| `generate_test` / `generate_api_test` cannot fix a failure | Added to Broken Tests | Based on spec path |
| `investigate_and_fix` resolves a failure | Entry moved from Broken to passing | Based on spec path |
| `sync-registry` runs | Full reconciliation of both registries | Both |

Running `npm test` manually **never** touches either registry.

---

## sync-registry

Use this when the registry may be out of sync — after a server crash mid-generation,
after adding tests manually, or after fixing a broken test outside of the MCP tools.

```bash
npm run sync-registry
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

---

## update-registry

A faster, narrower version of `sync-registry`. Only re-runs specs that already have
entries in the Broken or Application Bugs sections — skips the full suite.

```bash
npm run update-registry
```

Use this when you've fixed a broken test or the site has been patched for a known
app bug and you want to check if the entries can be promoted to passing.

---

## sync-registry vs update-registry

| | sync-registry | update-registry |
|--|---------------|-----------------|
| Runs the full suite | ✓ | ✗ (only affected specs) |
| Handles both TEST_CASES.md and TEST_API.md | ✓ | ✓ |
| Finds undocumented passing tests | ✓ | ✗ |
| Finds regressions in passing tests | ✓ | ✗ |
| Promotes resolved broken/app-bug entries | ✓ | ✓ |
| Speed | Slower (full suite) | Fast |

**Rule of thumb:** use `update-registry` after a targeted fix; use `sync-registry`
after bulk changes, a period of inactivity, or if you're unsure about the state.

---

## Fuzzy name matching

When a test name changes slightly between generation attempts (e.g. "place order" vs
"place an order"), the exact key lookup would fail to match the old broken entry with
the new passing test, leaving stale records.

Both tools normalise test names before comparing — stripping articles (`a`, `an`,
`the`), lowercasing, collapsing punctuation — so minor wording drift doesn't prevent
broken entries from being promoted.

---

## Manual cleanup after annotation

When a broken or app-bug test is fixed and `sync-registry` promotes it, the
`/* ⚠️ BROKEN */` or `/* ⚠️ APP BUG */` comment in the spec file is **not**
removed automatically. Remove it manually after the entry leaves the broken section.
