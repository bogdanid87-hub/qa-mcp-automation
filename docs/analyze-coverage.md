# analyze\_coverage

Analyses the existing test suite and identifies coverage gaps and risk areas.
Scopes to a specific spec file, folder, or registry — or runs across the full suite.
Writes `coverage-report.md` (always) and optionally `coverage-gaps.txt` in the
`prd-tests.txt` batch format for direct generation.

---

## When to use it

- After writing your first test for a feature — see what negative cases are missing
- Before a sprint — identify the highest-priority untested areas
- When given a new page URL — discover what should be tested there
- Periodically across the full suite — catch gaps that built up over time

---

## How it differs from `analyze_prd`

| | `analyze_prd` | `analyze_coverage` |
|--|---------------|-------------------|
| Starting point | PRD / feature description | Existing spec files and registries |
| Output | What *should* be tested | What *isn't* tested yet |
| Direction | Requirements → test cases | Test suite → gaps |

They are complementary: `analyze_prd` builds the initial backlog; `analyze_coverage`
identifies what drifted or was never written.

---

## Priority vs Risk

Each gap has two separate fields:

**Risk** — the intrinsic criticality of the *feature* being tested  
- critical: checkout, payment, cart totals
- high: login, registration, account management
- medium: search, filtering, navigation
- low: static pages, newsletter, contact form

**Priority** — the urgency to *write this test*, which can be higher than risk when:
- The gap covers the dominant user path while only an optional variant is tested
  *(e.g. contact form always tested WITH a file, so no-file is medium priority even though the feature is low risk)*
- It is the only test for a given flow — any regression is invisible
- A regression in this path would not be caught by any existing test

The `note` field appears on gaps where priority diverges from risk, explaining why.

---

## Usage

### From the terminal

```bash
# Scope to a single spec file
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts

# Scope to all specs in a folder
npm run analyze_coverage -- --spec tests/ui/

# Scope to a registry file
npm run analyze_coverage -- --registry TESTS_UI.md

# Add feature context from a page or docs URL
npm run analyze_coverage -- --spec tests/api/ --url https://automationexercise.com/api_list

# Discover what to test on a page you haven't started on yet
npm run analyze_coverage -- --url https://automationexercise.com/brand_products/Polo

# Full suite analysis (all registries, no spec filter)
npm run analyze_coverage

# Also write coverage-gaps.txt in batch format
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --gaps

# Deep mode — extra Claude pre-pass to identify untested paths (costs one extra call)
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --deep
```

### From Claude Code

```
Analyse coverage for the contact us tests
Analyse API test coverage — url: https://automationexercise.com/api_list
Check what's missing in the cart spec
```

### Parameters

| Parameter | CLI flag | MCP param | Description |
|-----------|----------|-----------|-------------|
| Spec path | `--spec` | `spec_path` | Spec file or folder to focus on |
| Registry | `--registry` | `registry_path` | Registry file (TESTS_UI.md / TESTS_API.md / TESTS_E2E.md) |
| URL | `--url` | `url` | Page or docs URL for feature context |
| Gaps file | `--gaps` | `generate_gaps` | Also write `coverage-gaps.txt` |
| Deep mode | `--deep` | `deep` | Pre-analysis pass for untested paths (extra Claude call) |

---

## URL handling — site vs docs

When the URL points to `automationexercise.com`, the tool uses **DOM inspection**
(same as `inspect_page`) to extract `[data-qa]` attributes, inputs, buttons, and
nav links. This gives Claude concrete, locator-level information about what's
testable on the page.

When the URL points to any other host (docs, wikis, API references), the tool
extracts **plain text** via headless browser — sufficient for understanding what
the page documents.

---

## Output files

**`coverage-report.md`** — always written to the project root. Human-readable,
sorted by priority, with risk shown when it differs. The `note` field appears
inline when priority diverges from risk.

**`coverage-gaps.txt`** — written only with `--gaps`. Same format as `prd-tests.txt`,
sorted by priority, with `# priority:` and optional `# note:` fields. Directly
runnable:

```bash
npm run generate -- --file coverage-gaps.txt
```

### Requirements coverage (deterministic)

When `REQUIREMENTS.md` exists and has at least one entry (see
[analyze-prd](analyze-prd.md)'s traceability ledger), `coverage-report.md` ends with
a "## Requirements coverage (deterministic)" section — a free, zero-token cross-check
computed as `requirementIds (from REQUIREMENTS.md) − reqIdsCoveredByTests (parsed
from `@req:REQ-NNN` tags across TESTS_UI.md/TESTS_API.md/TESTS_E2E.md)`. It lists any
requirements with zero covering tests. This is computed project-wide regardless of
`spec_path`/`registry_path` scoping, and complements (doesn't replace) the LLM-driven
gap analysis above. The same counts also appear as a "Requirements: X/Y covered"
line in `npm run status` output. When `REQUIREMENTS.md` doesn't exist yet (the
default for most projects), both are omitted entirely.

---

## Deep mode (--deep)

Makes an extra Claude call before the main analysis. The pre-pass reads the spec
and asks: *"which paths, variants, input types, and error states are NOT exercised
by the existing tests?"* That answer is included as additional context for the main
analysis, improving accuracy of gap detection and priority assignment.

Useful when the spec is complex (many test interactions, multiple flows) and you
want the most accurate possible gap list. Costs approximately double — use for
important specs where quality matters more than cost.

---

## Typical workflow

```bash
# 1. Check what's missing after writing your first test
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts

# 2. Review coverage-report.md — decide which gaps to address

# 3. Generate a runnable gaps file for the ones you want
npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --gaps

# 4. Generate the tests
npm run generate -- --file coverage-gaps.txt
```
