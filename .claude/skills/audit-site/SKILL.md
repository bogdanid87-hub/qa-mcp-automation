---
name: audit-site
description: Crawls a site, fingerprints page types, recommends a POM hierarchy, and generates test-data/constants.ts (npm run audit_site, CLI only — no MCP tool). Run before writing POMs on a new project. Load when planning POM architecture or refreshing test data.
---

# audit_site

Crawls a site, identifies all distinct page types, analyses shared UI components,
recommends a POM hierarchy, and generates typed test data constants. Run **before
writing any POMs** on a new project, or after a major site redesign. CLI only — no
MCP tool.

## Usage

```bash
npm run audit_site -- --url https://example.com                 # full run (recommended)
npm run audit_site -- --url https://example.com --mode structure # POM hierarchy only, no Claude call
npm run audit_site -- --url https://example.com --mode data      # refresh constants.ts only
npm run audit_site -- --url https://example.com --output docs/pom-audit.md
npm run audit_site -- --url https://example.com --max 30          # page-type limit (default 20)
```

## Structure output (`--mode structure`)

Writes `workspace/site-audit-report.md` (human-readable matrix + hierarchy recommendation)
and `workspace/site-audit-report.json` (read automatically by
[generate-pom](../generate-pom/SKILL.md#site-audit-enrichment) to inject hints).

Contains: discovered page types with URLs, **universal elements** (present on
every page → `SitePage`/`BasePage`), **partial-overlap groups** (shared by 2+
pages → intermediate class candidates), per-page element inventory, and a
recommended POM hierarchy.

## Test data output (`--mode data`)

Crawls `/products` and `/login`, then calls Claude to generate
`test-data/constants.ts` — `PRODUCTS` (from the live catalogue), `SEARCH`
(valid/invalid/partial terms), `TEST_USER` (with a function `email()` for
uniqueness per run), `PAYMENT` (card data with `expiryYear` always 2 years out).
Re-run with `--mode data` when the catalogue changes. The file is committed —
contributors don't need to re-run it.

## App knowledge candidates

Both modes append observations to `workspace/APP_KNOWLEDGE_CANDIDATES.md` for human
review (see [generate-app-knowledge](../generate-app-knowledge/SKILL.md)): structure
mode notes universal elements/partial-overlap groups; data mode flags when no search
input is found on `/products`. Re-running the same mode against the same URL
replaces that source's section.

## Interpreting the structure output

- **Universal elements** → `SitePage`/`BasePage`
- **Partial-overlap groups** → for each: if 2+ pages under test share it, make an
  intermediate class; if only 1, leave it in the concrete page class
- **Unique elements** (per-page only) → concrete page class only

## Limitations

- Doesn't authenticate — only public pages crawled
- Cookie consent overlays may block element detection on some pages
- Pages requiring login need manual supplementation

## Recommended workflow for new projects

```
1. audit_site --url <target>     → workspace/site-audit-report.{md,json}, test-data/constants.ts
2. Write BasePage/SitePage/intermediate classes by hand, informed by the report
3. generate_pom /page-a /page-b   → audit hints injected, validated locators
4. generate_test                  → imports from test-data/constants.ts
```

Full guide: [docs/audit-site.md](../../../docs/audit-site.md)
