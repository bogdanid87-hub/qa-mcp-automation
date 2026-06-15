---
name: init-project
description: Bootstraps mcp-qa.config.json plus a minimal pages/fixtures/tests scaffold for a new project (init_project MCP tool / npm run init_project). Load when starting a new site/project with this server.
---

# init_project

Bootstraps `mcp-qa.config.json` plus a minimal `pages/`/`fixtures/`/`tests/` scaffold
for a **new** project. Pure file I/O — no `audit_site`, no Claude/Ollama calls, no
Playwright run.

## When to run

Once, when starting a new site/project. Replaces the manual "clone the skeleton,
hand-edit `mcp-qa.config.json`" step.

## Usage

```
init_project project_name="my-shop" site_url="https://example.com"
init_project project_name="my-shop" site_url="https://example.com" profile="ecommerce"
```

```bash
npm run init_project -- --name my-shop --url https://example.com
npm run init_project -- --name my-shop --url https://example.com --profile ecommerce --output ../my-shop/mcp-qa.config.json
```

## Key points

- **`profile`** (`"generic"` default or `"ecommerce"`) picks a starting `riskTiers`
  keyword set — `generic` is domain-agnostic (auth/CRUD/financial-action based),
  `ecommerce` is shopping vocabulary. `risk_tiers` overrides individual tiers on top
  of either profile. Both are starting points — review against real critical flows.
- **Config write** refuses to overwrite an existing `mcp-qa.config.json` unless
  `force: true`.
- **Scaffold** (`tests/{ui,api,e2e,visual}/.gitkeep`, `test-data/.gitkeep`,
  `pages/BasePage.ts`, `pages/SitePage.ts`, `fixtures/index.ts`,
  `workspace/START_HERE.md`, `workspace/my-test.txt`, `workspace/prd.md`) is always
  create-if-missing, **never overwritten** — even with `force: true`. This protects
  any hand-customized `SitePage.ts` etc.
- Prints next steps: `audit_site` → fill in `pom`/`riskTiers` from its report →
  `generate_pom` → `generate_test` → open `workspace/START_HERE.md` for a
  plain-English walkthrough of describing/generating/checking a test.

Full guide: [docs/init-project.md](../../../docs/init-project.md). Config schema and
POM hierarchy conventions: [qa-conventions](../qa-conventions/SKILL.md).
