# learn_conventions

Reads an existing project's `pages/`, `fixtures/`, tests, and `playwright.config.ts` to
**detect the conventions it already uses**, then makes the engine's generation match that
house style instead of imposing its defaults. The goal: drop the engine into a project that
already has tests and have `generate_test` produce code that looks like the code already
there.

Detection is read-only and **token-free** (regex/heuristic — no AST dependency, no LLM call).

---

## When to run

After dropping the engine into an existing Playwright + TypeScript project (i.e. after
`npx qa-init`), before generating tests — so generation picks up the project's hierarchy,
fixtures, data source, and API style.

---

## What it detects

- **POM hierarchy** — the page-helper class graph. Handles both the two-tier
  `BasePage → SitePage` shape and the **collapsed** shape where the base class itself owns
  the site nav (no separate `SitePage`). Finds intermediate classes and the locators/methods
  the site class already provides. Detects `pages/components/` composition objects.
- **Fixtures** — what `fixtures/index.ts` exports, the injected page/helper fixtures, the base
  extension (e.g. a route-blocker), and whether a `trackCleanup` fixture exists.
- **Authoring idioms** — how tests consume page helpers (injected fixtures vs `new`), the
  `test`/`expect` import path, the test-data source, and the API style (an `ApiClient`
  abstraction vs the raw `request` fixture).
- **Runner** — the active Playwright projects (commented-out ones ignored), which browsers /
  visual project exist, and the setup style.

It writes a human-readable report to `workspace/PROJECT_CONVENTIONS.md`.

---

## Applying what it detects

By default `learn_conventions` only writes the report. To make generation use the conventions,
apply them to `mcp-qa.config.json` (dry-run preview unless `--write`):

```bash
npm run learn_conventions                                   # report only
npm run learn_conventions -- --apply-pom                    # preview the hierarchy → config.pom
npm run learn_conventions -- --apply-pom --apply-conventions --write   # apply both
```

- `--apply-pom` writes the detected hierarchy into `config.pom` (base/site class, intermediate
  classes, `siteClassProvides`) and sets `config.testing.runnerProject` so `run_tests` targets
  the project's own primary project. Human-authored `description`/`paths` on intermediate
  classes are preserved.
- `--apply-conventions` writes a concise conventions block into `config.prompts.conventions`.
  That block is injected at the **top** of the generation prompt with explicit precedence —
  where any general engine rule conflicts, the model follows the project's convention.

The same controls are available on the MCP tool (`apply_pom`, `apply_conventions`, `write`) and
the `qa-learn` bin (runs config-free, so you can preview a project before `qa-init`).

---

## How well it works (validated)

Validated against a real hand-written suite (automationexercise.com) with a **collapsed**
hierarchy, fixture-injection, an `ApiClient` abstraction, centralised `data/testData.ts`, and
no `trackCleanup`. After `learn_conventions --apply-pom --apply-conventions --write`,
`generate_test` produced:

- **UI test** — imported from the project's `../../fixtures/index`, extended/used `BasePage`
  and its real methods (from `siteClassProvides`), respected the collapsed hierarchy, used
  `../../data/testData`, injected the project's fixtures, and added tagged negative tests — no
  `trackCleanup`.
- **API test** — used the project's `apiClient` fixture (not raw `request`) and `data/testData`.

### Known limitations

- The conventions tell the model to **use** the `apiClient` / page-helper fixtures, but don't
  yet enumerate their **method signatures** — so it can invent a generic call (e.g.
  `apiClient.post()` instead of the project's `apiClient.verifyLogin()`), and may occasionally
  `new` a base page instead of using its fixture. Surfacing the available methods/fixtures to
  generation (a small "project map") is the natural next step.
- The POM directory (`pages/`) and fixtures file (`fixtures/index.ts`) are still assumed;
  projects using different locations need those aligned.
- Parsing is regex-based; very unusual class structures may need a manual `config.pom` tweak.

---

## Cost

Detection and apply are **token-free** (pure file parsing + config writes). Only the
subsequent `generate_test` spends tokens.
