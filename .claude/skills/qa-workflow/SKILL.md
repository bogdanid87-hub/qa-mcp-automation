---
name: qa-workflow
description: Collaboration rules and safety rails for qa-mcp-automation — branch/PR workflow, when to ask before acting, and look-ahead checks before adding code. Load before any code change, test run, commit, or PR in this repo.
---

# QA Workflow — Collaboration Rules

Apply these rules to every piece of work in `qa-mcp-automation`, whether the user
asked for it or you're making a direct edit yourself.

## Before touching files

- **Ask before updating `CLAUDE.md`** — notify the user and wait for confirmation.
- **Never commit changes to `tests/`, `pages/`, `fixtures/`, or `src/prompts/`**
  without running the affected spec first:
  `npx playwright test --project=chromium <spec>` — confirm it passes before
  staging. No exceptions.
- **Never fix a test file directly** without first telling the user the fix is
  happening outside the normal tool flow — explain what's changing and why before
  touching the file.
- **When given permission to fix tests manually**, also close the root cause:
  update `src/prompts/system.ts` (CORE_RULES), `learned-rules.md`, or
  the relevant tool code so the same issue can't recur. A fix that only patches one
  file without addressing the cause is incomplete.

## Before running commands

- **Never run token-consuming operations** — Claude API calls, Playwright test
  runs, Ollama inference, `npm run fix`, `npm run generate`, `npm run analyze_prd`,
  etc. — without first notifying the user and receiving permission.
- `git push` triggers a pre-push hook that runs the full Playwright suite
  (`npm test`, ~39 specs). Mention this before pushing so a failure in the push
  output isn't a surprise. If a run fails broadly right after heavy testing
  activity, that's likely live-site load, not a regression — waiting a few minutes
  and retrying is often enough.

## Git / PR workflow

- **Never commit or push without the user explicitly asking.**
- **Use PRs for all changes** — never push directly to `main`. Work on a feature
  branch (one per logical unit of work, announced when created), commit there, and
  open a PR with `gh pr create` summarising what changed and why.

## When adding or changing a tool

Update ALL of these in the same commit as the code — never as a follow-up:

- `docs/<tool-name>.md` — create or update the per-tool guide
- `.claude/skills/<tool-name>/SKILL.md` — create or update the thin skill (frontmatter
  `description`, condensed usage/params, cross-links) to match the doc
- `TOOLS.md` — both the MCP tools table and terminal commands table, with doc links
- `CLAUDE.md` — tool count in the header, plus key commands if it's a daily-use tool
- `README.md` — tool count (header + tools section + architecture block), tools
  table, terminal commands list

After any session that adds features (not just tools), also update README.md's
"What this project demonstrates" section and TOOLS.md's terminal commands table —
these are frequently missed for scripts, CI workflows, or capabilities spanning
multiple files.

## Keep the engine project-agnostic

The `mcp-qa-skeleton` repo is retired — the engine itself (`src/`) is being packaged
for `npm install`, and `init_project` now scaffolds a complete runnable project for
any site. There is no separate skeleton to propagate to. The flip side: a general
improvement belongs in `src/` and stays config-driven (no hardcoded site values),
while anything project-specific stays in the reference project's files only.
Project-specific Cloudflare workarounds (request retries, `page.request`, stealth
launch args, webdriver spoofing) live in the reference `tests/`/`utils/` and must
never be generalized into `src/` or the `init_project` scaffold.

## generate_test follow-up

After every `generate_test` call that returns proposed additional tests, present
them as a numbered list and invite the user to pick any, with or without
modifications — e.g. "generate 2 but start from the home page instead". Apply
natural-language adjustments to the description before calling the tool again.

## Look-ahead: check before you add (applies to your own direct edits too)

`src/prompts/system.ts` tells the MCP tool's generation step to check for existing
POM methods, fixtures, and shared helpers before adding new ones. The same
principle applies when *you* edit this repo's `pages/`, `fixtures/`, `tests/`, or
`utils/` directly:

- **New POM method or locator** — check the POM Method Index first: run
  `buildPomIndex`/`formatPomIndex` from `src/tools/pom-index.ts` over `pages/*.ts`
  (the same index `generate_test` injects into its own context) for an equivalent
  method on *any* class, not just the one you're editing — this is what catches
  forwarding aliases (e.g. a new `getProductName` when `getRowProductName` already
  exists on another page). If a parent class (`SitePage`, `ProductListPage`,
  `BasePage`) already exposes it, don't redeclare it in a subclass. See
  [qa-conventions](../qa-conventions/SKILL.md) for the hierarchy.
- **New fixture** — check `fixtures/index.ts` before adding one. `trackCleanup` is
  already a built-in fixture; never propose re-adding it.
- **New spec file** — never instantiate `new SomePage(page)` directly in a spec;
  use the fixture from `fixtures/index.ts`.
- **Currency/price parsing or other shared logic** — check `utils/` (e.g.
  `utils/price.ts`) before writing inline parsing in a spec or POM.
- **New `{content:[...]}` error returns** — use `errorContent()` from
  `src/lib/format-error.ts` instead of hand-rolling the shape, so failures get a
  category, label, and plain-English next step. Extend `detectCategory` if a failure
  doesn't fit the existing `config`/`transient`/`code_bug`/`app_bug`/`unknown`
  categories.

Three similar lines is better than a premature abstraction — but a *duplicate* of
something that already exists elsewhere is a bug waiting to diverge, not a
stylistic choice.
