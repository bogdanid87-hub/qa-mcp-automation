# Visual Regression Tests

**Total: 3 tests**

Visual tests capture LAYOUT STRUCTURE of static elements — nav bars, sidebars,
forms, and other elements whose content does not change with application data.
Baselines are OS-specific (`-darwin.png` on macOS, `-linux.png` on CI/Linux).

**First-time CI setup:** Run the `update-visual-baselines` GitHub Action once to
generate Linux baselines. See `.github/workflows/update-visual-baselines.yml`.

**After intentional UI changes:** Run `npm run test:update-snapshots`, review the
diffs, commit the updated PNG files.

> **Note:** For data-driven areas (product grids, search results, user content),
> use `page.route()` mocks to control the data before capturing. See the skeleton's
> `tests/visual/mocked-content.spec.ts.example` for the pattern.

---

## tests/visual/products.spec.ts

### Products Page — Static Layout

| # | Test |
|---|------|
| 1 | should match the navigation bar layout |
| 2 | should match the left sidebar structure |
| 3 | should match the search bar layout |

