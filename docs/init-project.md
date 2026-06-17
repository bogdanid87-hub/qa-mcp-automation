# init_project

Bootstraps `mcp-qa.config.json` plus a **complete, runnable** project scaffold —
the Playwright setup (`playwright.config.ts`, `tests/global.setup.ts`, `tsconfig.json`,
`.gitignore`) and the `pages/`/`fixtures/`/`tests/` skeleton — for a **new** project.
Pure file I/O — no `audit_site`, no Claude/Ollama calls, no Playwright run.

---

## When to run

Once, when starting a new site/project with this server. It replaces the manual
"clone the skeleton, hand-edit `mcp-qa.config.json`" step: `init_project` writes a
config that already passes `validate()`, plus the directory/file skeleton the config
implies, and prints the next steps to take.

---

## Args

| Param | Required | Description |
|-------|----------|-------------|
| `project_name` | yes | Name for the new project, e.g. `"my-shop"` — written to `project.name` |
| `site_url` | yes | Base URL of the site to test, e.g. `"https://example.com"` — written to `project.siteUrl`. Must be a valid URL (checked with `new URL(...)`). |
| `profile` | no | Risk-tier keyword profile: `"generic"` (default) or `"ecommerce"` — see [Risk-tier profiles](#risk-tier-profiles) |
| `output_path` | no | Where to write `mcp-qa.config.json` (default: `./mcp-qa.config.json`). The scaffold is written relative to this path's directory. Mainly useful for previewing the output in a scratch directory without touching the current project's config/scaffold — see [Multi-project setup](#multi-project-setup) for how this fits into onboarding an actual new project. |
| `force` | no | Overwrite an existing `mcp-qa.config.json` (default: `false` — refuses if one already exists). **Scaffold files are always create-if-missing, regardless of this flag** — see [Scaffold](#scaffold). |
| `risk_tiers` | no | Per-tier overrides (`critical`/`high`/`medium`/`low` string arrays), merged on top of the chosen `profile`. Omitted tiers keep the profile's defaults. |

---

## Risk-tier profiles

There's no single keyword list that fits every domain, so `init_project` picks from
two starting profiles:

- **`generic`** (default) — domain-agnostic, based on test *intent* rather than
  shopping vocabulary:
  - `critical`: `delete`, `remove`, `cancel`, `payment`, `checkout`, `purchase`,
    `transfer`, `refund` — irreversible/financial actions.
  - `high`: `auth`, `login`, `logout`, `signup`, `register`, `password`, `account`,
    `session`, `permission`, `role` — authentication/identity.
  - `medium`: `search`, `filter`, `sort`, `create`, `update`, `edit`, `form`,
    `upload`, `settings` — core CRUD/interaction.
  - `low`: `contact`, `about`, `faq`, `static`, `footer`, `help`, `terms`, `privacy`
    — informational/marketing.
- **`ecommerce`** — shopping-site vocabulary (`checkout`/`payment`/`order`/`cart`,
  `product`/`listing`/`detail`, etc.) — a good fit for shop-like demo sites such as
  automationexercise.com or saucedemo.com.

Either profile is a **starting point**, not a final answer — review `riskTiers` in
the generated config against your project's actual critical flows. `risk_tiers`
overrides individual tiers on top of the chosen profile, e.g. pick `generic` but
supply your own `critical` keywords.

---

## Generated config

`mcp-qa.config.json` always uses the 4-registry `ui`/`api`/`e2e`/`visual` shape:

```jsonc
{
  "project": { "name": "demo-shop", "siteUrl": "https://example.com" },
  "testing": {
    "folders":    { "ui": "tests/ui", "api": "tests/api", "e2e": "tests/e2e", "visual": "tests/visual" },
    "registries": { "ui": "TESTS_UI.md", "api": "TESTS_API.md", "e2e": "TESTS_E2E.md", "visual": "TESTS_VISUAL.md" }
  },
  "riskTiers": { "critical": [...], "high": [...], "medium": [...], "low": [...] },
  "pom": { "baseClass": "BasePage", "siteClass": "SitePage", "siteClassProvides": [], "intermediateClasses": [] },
  "models": { "primary": "claude-sonnet-4-6", "local": "qwen2.5-coder:14b" }
}
```

`pom.siteClassProvides` and `pom.intermediateClasses` start empty — populate them
once `audit_site` has run (see [Next steps](#next-steps)).

The `testing.folders` and `testing.registries` paths are honored end-to-end — the
generation prompt, `specKind`/`registryForSpec` routing, and the scaffolded
`playwright.config.ts` all read them — so you can relocate them (e.g. rename
`tests/ui` → `tests/web`, or `TESTS_UI.md` → `WEB_TESTS.md`) and everything follows.
Keep `tests/global.setup.ts` where the `setup` project finds it.

---

## Scaffold

Alongside the config, `init_project` lays down the directory/file skeleton the config
implies — **create-if-missing only, never overwritten**, independent of `force`
(which applies only to `mcp-qa.config.json` itself):

- `playwright.config.ts` — runnable config with `setup` + `chromium` + `firefox` +
  `webkit` + a chromium `visual` project; `baseURL` is read from `mcp-qa.config.json`
- `tests/global.setup.ts` — saves guest storage state (`test-data/.auth/guest.json`)
  the browser projects depend on
- `tsconfig.json`, `.gitignore`
- `tests/ui/.gitkeep`, `tests/api/.gitkeep`, `tests/e2e/.gitkeep`,
  `tests/visual/.gitkeep`, `test-data/.gitkeep`
- `pages/BasePage.ts` — `navigate(path, dismissOnLoad?)` (waits for
  `domcontentloaded`, plus a popup-dismissal hook), no other deps
- `pages/SitePage.ts` — TODO-commented `extends BasePage` placeholder for
  universal locators (nav, footer, logged-in indicator)
- `fixtures/index.ts` — `export const test = base.extend({})` with a TODO showing
  how to add a fixture per Page Object
- `workspace/START_HERE.md` — plain-English walkthrough: describe a test in
  `workspace/my-test.txt`, generate it, read the result, check `npm run status`
- `workspace/my-test.txt` — templated example description, points back to
  `workspace/START_HERE.md`
- `workspace/prd.md` — templated PRD placeholder for `analyze_prd`, also points back
  to `workspace/START_HERE.md`

These are deliberately minimal and dependency-free — no `utils/popupDismisser`,
`utils/adBlocker`, or `trackCleanup`. Those are project-specific enhancements layered
on top later, not part of the baseline scaffold.

If a file already exists (e.g. you've already customized `pages/SitePage.ts`), it's
left untouched and reported as `skipped (already exists)` — even with `force: true`.

---

## Next steps

After `init_project` writes the config and scaffold, it prints:

1. Run `npm run audit_site -- --url <site_url>` to discover the site's page structure.
2. Use the audit report to fill in `pom.intermediateClasses`, `pom.siteClassProvides`,
   and `riskTiers` in `mcp-qa.config.json`.
3. Run `generate_pom` against your homepage/login page to populate `pages/SitePage.ts`
   with real locators.
4. Run `generate_test` for your first test.
5. Open `workspace/START_HERE.md` for a plain-English guide to describing,
   generating, and checking your first test.

---

## Usage

**MCP tool (Claude Code chat):**
```
init_project project_name="my-shop" site_url="https://example.com"
init_project project_name="my-shop" site_url="https://example.com" profile="ecommerce"
```

**CLI:**
```bash
npm run init_project -- --name my-shop --url https://example.com
npm run init_project -- --name my-shop --url https://example.com --profile ecommerce
npm run init_project -- --name my-shop --url https://example.com --output ../my-shop/mcp-qa.config.json
npm run init_project -- --name my-shop --url https://example.com --force
```

Per-tier `risk_tiers` overrides are available via the MCP tool's schema for
programmatic callers; the CLI does not expose them as flags.

---

## Multi-project setup

`init_project` bootstraps the **project-specific** files — `mcp-qa.config.json`, the
Playwright setup (`playwright.config.ts`, `tests/global.setup.ts`, `tsconfig.json`,
`.gitignore`), and the `pages/`/`fixtures/`/`tests/`/`test-data/` skeleton. It does
not copy the engine itself (`src/`, the engine's own `package.json`, CI workflows).
The engine is being packaged for `npm install`; until then, clone this repo to get it:

1. Clone this repo into a new directory for the new project, `npm install`,
   `npx playwright install` (downloads chromium/firefox/webkit).
2. From inside that clone, run `npm run init_project -- --name <name> --url <site>`
   (no `--output` needed — it defaults to `./mcp-qa.config.json` in that project's
   root) to write the config and the runnable scaffold. The scaffold is
   create-if-missing, so it won't clobber the reference project's existing files —
   point `--output` at an empty directory to onboard a genuinely separate project.
3. Continue with the printed next steps (`audit_site` → `generate_pom` →
   `generate_test`) — the first `generate_test` runs against the live site with no
   further setup.

Each project is fully independent — its own `mcp-qa.config.json`, `pages/`,
`learned-rules.md`, registries. For two unrelated projects that share some domain
vocabulary (e.g. a web app and a mobile app for the same business), define a custom
`risk_tiers` profile once and pass it to `init_project` for each project — there's no
shared config between projects beyond what you copy/paste deliberately.

`output_path`/`--output` (pointing at a path outside the current project) is for
previewing what `init_project` would generate — e.g. into a scratch `/tmp` directory
— without touching the current project's files. It does not produce a runnable
project on its own.

---

## Cost

None — pure file I/O. No Claude/Ollama calls, no Playwright run.
