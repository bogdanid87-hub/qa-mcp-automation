---
name: analyze-coverage
description: Analyses the test suite for coverage gaps and risk, scoped to a spec/folder/registry or the full suite — writes workspace/coverage-report.md and optional workspace/coverage-gaps.txt (analyze_coverage MCP tool / npm run analyze_coverage). Load when assessing what's missing or planning the next tests.
---

# analyze_coverage

Analyses the existing test suite and identifies coverage gaps and risk areas.
Scopes to a spec file, folder, registry, or the full suite. Always writes
`workspace/coverage-report.md`; optionally writes `workspace/coverage-gaps.txt` in `workspace/prd-tests.txt`
batch format for direct generation.

## When to use it

- After writing the first test for a feature — see what negative cases are missing
- Before a sprint — identify the highest-priority untested areas
- Given a new page URL — discover what should be tested there
- Periodically across the full suite — catch gaps that built up over time

## vs analyze_prd

| | `analyze_prd` | `analyze_coverage` |
|--|---------------|-------------------|
| Starting point | PRD / feature description | Existing spec files and registries |
| Output | What *should* be tested | What *isn't* tested yet |
| Direction | Requirements → test cases | Test suite → gaps |

Complementary: `analyze_prd` builds the initial backlog; `analyze_coverage` finds
what drifted or was never written. See [analyze-prd](../analyze-prd/SKILL.md).

## Requirements coverage (deterministic)

When `REQUIREMENTS.md` has entries (assigned by `analyze_prd`), `workspace/coverage-report.md`
ends with a free "## Requirements coverage (deterministic)" section: `requirementIds
− reqIdsCoveredByTests` (parsed from `@req:REQ-NNN` tags across all three
registries) — requirements with zero covering tests. Zero token cost, always
project-wide. The same counts appear in `npm run status` as "Requirements: X/Y
covered". Omitted entirely when `REQUIREMENTS.md` doesn't exist or is empty.

Covering tests are also classified by `@negative`/`@boundary` tags (see
[generate-test](../generate-test/SKILL.md)). Requirements covered only by
`functional` tests are listed under "**Covered by functional tests only**", and the
summary line gets a `, N functional-only` suffix.

Independent of `REQUIREMENTS.md`, `npm run status` always shows "🏷️ Test types: N
functional · N negative · N boundary" (project-wide, UI/API/E2E only).

## App knowledge candidates

When Claude observes something about app *behaviour* not already covered by
`workspace/APP_KNOWLEDGE.md`/`APP_LIMITATIONS.md`, it's appended to
`workspace/APP_KNOWLEDGE_CANDIDATES.md` under an `analyze_coverage — <scope>` section
for human review (replaces on re-run, doesn't duplicate). See
[generate-app-knowledge](../generate-app-knowledge/SKILL.md). Often empty.

## Priority vs Risk

**Risk** = intrinsic criticality of the *feature* (critical: checkout/payment/cart
totals; high: login/registration/account; medium: search/filtering/navigation;
low: static pages/newsletter/contact).

**Priority** = urgency to *write this test*, which can exceed risk when: the gap
covers the dominant user path while only an optional variant is tested (e.g.
contact-form-with-file always tested, so no-file is medium priority despite low
feature risk); it's the only test for a flow (any regression invisible); or no
existing test would catch a regression. A `note` field explains divergence.

## Usage

```bash
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts        # one spec
npm run analyze_coverage -- --spec tests/ui/                        # a folder
npm run analyze_coverage -- --registry TESTS_UI.md                  # a registry
npm run analyze_coverage -- --spec tests/api/ --url <api-docs-url>  # + feature context
npm run analyze_coverage -- --url <page-url>                        # page not yet tested
npm run analyze_coverage                                             # full suite
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --gaps  # + workspace/coverage-gaps.txt
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --deep  # extra pre-pass, ~2x cost
```

```
Analyse coverage for the contact us tests
Analyse API test coverage — url: https://automationexercise.com/api_list
```

| Parameter | CLI flag | MCP param | Description |
|-----------|----------|-----------|-------------|
| Spec path | `--spec` | `spec_path` | Spec file or folder to focus on |
| Registry | `--registry` | `registry_path` | `TESTS_UI.md` / `TESTS_API.md` / `TESTS_E2E.md` |
| URL | `--url` | `url` | Page or docs URL for feature context |
| Gaps file | `--gaps` | `generate_gaps` | Also write `workspace/coverage-gaps.txt` |
| Deep mode | `--deep` | `deep` | Pre-analysis pass for untested paths (extra Claude call) |

## URL handling

`automationexercise.com` URLs use DOM inspection (like
[inspect-page](../inspect-page/SKILL.md)) — `[data-qa]`, inputs, buttons, nav
links. Other hosts (docs/wikis) get plain-text extraction.

## Deep mode

Extra Claude pre-pass asking "which paths/variants/input types/error states are
NOT exercised by the existing tests?" — feeds the answer into the main analysis.
Use for complex specs where gap-detection accuracy matters more than ~2x cost.

## Typical workflow

```bash
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --gaps
# review workspace/coverage-report.md, then:
npm run generate -- --file workspace/coverage-gaps.txt
```

Full guide: [docs/analyze-coverage.md](../../../docs/analyze-coverage.md)
