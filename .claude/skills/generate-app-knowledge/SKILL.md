---
name: generate-app-knowledge
description: Synthesises APP_KNOWLEDGE.md from bug/gap/coverage data (generate_app_knowledge MCP tool / npm run generate_knowledge) — enriches analyze_prd and analyze_coverage. Load when running it, or discussing APP_KNOWLEDGE.md / APP_LIMITATIONS.md.
---

# generate_app_knowledge

Synthesises accumulated knowledge into `APP_KNOWLEDGE.md` — a per-feature risk
document covering known app bugs, recurring coverage gaps, and risk patterns.
`analyze_prd` and `analyze_coverage` read it automatically to weight their analysis
toward features with known defects/gaps.

## When to run

- After a new app bug is recorded (`investigate_and_fix` classified a failure as
  an app bug)
- After `analyze_coverage`/`analyze_prd` adds new rows to `GAPS_BACKLOG.md`
- After the coverage report is regenerated
- At the start of a new QA session, to bring context current

## Sources

| Source | Contributes |
|--------|-------------|
| `TESTS_UI.md`, `TESTS_API.md`, `TESTS_E2E.md`, `TESTS_VISUAL.md` | App bug entries — feature, root cause, actual behaviour |
| `GAPS_BACKLOG.md` | Open gap entries (no ✅, no ~~strikethrough~~) |
| `coverage-report.md` | First 2000 chars — key risk findings |

## Output: APP_KNOWLEDGE.md

Grouped by feature area, fully overwritten on every run — don't edit directly:

```markdown
## [Feature area]
**Risk level:** critical | high | medium | low
**App bugs:** [bullet list, or "none"]
**Open gaps:** [bullet list, or "none"]
**Notes:** [one-line pattern or warning for future analysis]
```

## Persistent manual notes: APP_KNOWLEDGE_MANUAL.md

Create this in the project root for notes that survive every regeneration — the
tool appends it verbatim after a `---` rule, and never writes to it. Use for
architectural quirks, cross-feature risk patterns, or testing constraints (e.g.
"payment sandbox rejects amounts > £999 in headless").

## Usage

```
generate_app_knowledge
generate_app_knowledge output="path/to/custom.md"
```

```bash
npm run generate_knowledge
npm run generate_knowledge -- --output path/to/custom.md
```

## Effect on other tools

| File | Read by | Effect |
|------|---------|--------|
| `APP_KNOWLEDGE.md` | `analyze_prd`, `analyze_coverage` | Weights suggestions toward known-defect/gap features |
| `APP_LIMITATIONS.md` | `analyze_prd`, `analyze_coverage`, `generate_test` | Tells Claude not to suggest/generate tests for listed features |

## APP_LIMITATIONS.md — missing features

Human-maintained, never touched by any tool. Add an entry when a test concept
fails because the feature genuinely doesn't exist on the app (not a bug — just
absent), or when writing tests ahead of a planned feature. Do **not** add an entry
for a feature that exists but is broken — use the test registry instead
(`test.fail()` + app_bug annotation).

```markdown
## Navigation
- No cart item counter in nav bar — Cart link is plain text, no badge element.
```

## Staging area: APP_KNOWLEDGE_CANDIDATES.md

`analyze_coverage` and `audit_site` append candidate observations here
(`workspace/APP_KNOWLEDGE_CANDIDATES.md`, gitignored, not read by any tool). Each run
writes/replaces a dated section per source. Review periodically — promote durable
notes into `APP_KNOWLEDGE_MANUAL.md` or missing-feature notes into
`APP_LIMITATIONS.md`, then delete the entry.

## Cost

One Claude Sonnet 4.6 call, well under $0.01.

Full guide: [docs/generate-app-knowledge.md](../../../docs/generate-app-knowledge.md)
