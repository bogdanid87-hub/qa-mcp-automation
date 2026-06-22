# Install the engine in your own project

The QA engine ships as an installable npm package, **`@bogdanid87/qa-mcp-engine`**. You
don't clone this repo to use it — you add it as a dev dependency to whatever project you
want to test, scaffold a config, and Claude Code picks up the tools. One engine, any
number of projects; `npm update` instead of copy-paste.

> This repo itself remains the **reference implementation** — its `pages/`, `tests/`,
> `fixtures/`, and registries are real, accumulated output of the tools running against
> automationexercise.com. That content is *not* part of the published package (see the
> `files` allowlist in [package.json](../package.json)); the tarball is engine-only.

---

## What you get

The package publishes the engine source (run via `tsx`, no build step) plus six
command-line entry points:

| Bin | Purpose |
|-----|---------|
| `qa-mcp` | Launch the MCP server (stdio) — this is what `.mcp.json` runs so the 14 tools appear in Claude Code chat. |
| `qa-init` | Bootstrap `mcp-qa.config.json` + a runnable scaffold for a new project. Works in an empty repo. |
| `qa-generate` | Generate a UI/E2E/API test from a description. |
| `qa-fix` | Investigate and fix a failing test. |
| `qa-status` | Suite health at a glance. |
| `qa-analyze-prd` | Turn a PRD into a risk-tiered test backlog. |

All 14 tools are always reachable through the MCP server in chat; the bins are the
terminal shortcuts for the everyday five.

---

## Setup (≈2 minutes)

From the root of the project you want to test:

```bash
# 1. Install the engine + Playwright (peer dep) and browsers
npm install -D @bogdanid87/qa-mcp-engine @playwright/test @types/node
npx playwright install

# 2. Scaffold config + Playwright setup + the Claude Code MCP wiring
npx qa-init --name my-project --url https://my-site.example.com
```

`qa-init` writes (create-if-missing — it never clobbers your files):

- `mcp-qa.config.json` — site URL, folder/registry layout, risk tiers, POM hierarchy
- `.mcp.json` — launches `npx qa-mcp` so Claude Code exposes the QA tools
- `playwright.config.ts`, `tests/global.setup.ts`, `tsconfig.json`, `.gitignore`
- `pages/`, `fixtures/`, `tests/`, `test-data/` skeleton + `workspace/START_HERE.md`

```bash
# 3. Make your API key available, then reload Claude Code
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Reload Claude Code (or your editor) so it reads the new `.mcp.json`. Run `/mcp` — you
should see the `qa` server connected and the tools available. `.mcp.json` expands
`${ANTHROPIC_API_KEY}` from the environment that launches the editor.

---

## First test

```
1. Ask the audit_site tool (in chat) to crawl your site and recommend a POM hierarchy.
2. Fill in pom.intermediateClasses / pom.siteClassProvides / riskTiers in mcp-qa.config.json.
3. generate_pom against your homepage/login page → real locators in pages/SitePage.ts.
4. generate_test for your first test (or qa-generate from the terminal).
5. qa-status to check suite health.
```

`workspace/START_HERE.md` (scaffolded by `qa-init`) is the plain-English version of this.

---

## Notes

- **No build step.** The package ships TypeScript source and runs it through `tsx`; the
  bins are thin launchers that invoke tsx's CLI as a child process, so behaviour is
  identical to running the engine from source.
- **Run `qa-init` first.** The config-reading commands (`qa-status`, `qa-generate`, …)
  expect `mcp-qa.config.json` to exist; running one before `qa-init` errors because there's
  no config yet.
- **Updating:** `npm update @bogdanid87/qa-mcp-engine`. Your `pages/`, `tests/`,
  `fixtures/`, config, and `learned-rules.md` live in *your* repo and are untouched by an
  engine upgrade.
