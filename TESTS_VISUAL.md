# Visual Regression Tests

**Total: 0 tests**

Visual tests run against committed baseline screenshots (Chromium, local OS).
Baselines live next to the spec files in `tests/visual/__snapshots__/` and are
committed to git. Update baselines after intentional UI changes with:

```bash
npm run test:update-snapshots
```

> **Note:** Baselines are taken on the developer's OS. Small rendering differences
> between macOS and Linux CI may cause false positives. Increase
> `maxDiffPixelRatio` in `playwright.config.ts` if needed, or switch to
> Docker-consistent CI baselines (tracked in .qa-notes.md).

