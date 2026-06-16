# analyze\_prd

Reads a PRD or feature description, classifies every feature by risk, and writes
a `workspace/prd-tests.txt` file containing test case suggestions ready to feed into
`generate_test`. Tests already recorded in the registries (`TESTS_UI.md`, `TESTS_API.md`,
`TESTS_E2E.md`, `TESTS_VISUAL.md`) are filtered out, so the output is a genuine coverage
gap list rather than a repeat of what's already built.

---

## When to use it

- Starting automation on a new feature or sprint and you want a prioritised backlog
- Received a PRD in any format (Word, PowerPoint, Confluence, PDF) and need to turn it into test cases quickly
- You want to know which scenarios haven't been covered yet without reading through the registries manually

---

## Risk levels

Every test suggestion is classified into one of four tiers:

| Tier | What it means | Examples |
|------|--------------|---------|
| **critical** | Failure directly prevents a purchase or causes a financial error | Checkout flow, payment submission, cart total calculation, order confirmation |
| **high** | Failure erodes trust or surfaces wrong data | Login/registration, account management, order history, product pricing |
| **medium** | Failure reduces the chance of a purchase without blocking it | Product search, filtering, navigation, product detail accuracy |
| **low** | Failure is visible but rarely causes abandonment | Static pages, newsletter, social links, error pages |

---

## Input formats

### Existing spec file — `--file tests/ui/feature.spec.ts`

Point at an existing Playwright spec to find what's missing rather than what's already there. The tool extracts every `test(...)` name, tells Claude which scenarios are already implemented, and asks it to suggest additions — negative cases, boundary conditions, and untested flows.

```bash
npm run analyze_prd -- --file tests/ui/cart.spec.ts
npm run analyze_prd -- --file tests/ui/checkout.spec.ts --tier critical,high
npm run analyze_prd -- --file tests/api/products.spec.ts --focus search,filter
```

The output is written to `workspace/prd-tests.txt` in the same batch format as any other `analyze_prd` run — review, delete unwanted suggestions, then feed to `generate_test`.

---

### Web page — `--url`

Point directly at any URL — API documentation, a wiki page, a Confluence spec, a feature changelog. The tool navigates headlessly via Playwright, extracts the fully-rendered text, and passes it to Claude as the PRD. Handles JS-rendered content.

```bash
npm run analyze_prd -- --url https://automationexercise.com/api_list
npm run analyze_prd -- --url https://example.com/api-docs --tier high,critical
npm run analyze_prd -- --url https://wiki.internal/feature-spec --focus checkout
```

This is the recommended input for API test generation — point at the API docs page and get a test backlog without any copy-pasting.

---

### Text or Markdown — `prd.md`

Paste any content into `prd.md`: user stories, acceptance criteria, feature lists,
plain prose, mixed formats. The tool extracts structure from whatever you give it.

```bash
npm run analyze_prd -- --file prd.md
```

Copy the example template to get started:
```bash
cp prd.md.example prd.md
```

---

### PDF — `spec.pdf`

PDF is the recommended format when you have a polished spec from Word, PowerPoint,
Confluence, Notion, or Google Docs. Export directly to PDF — no copy-pasting needed.

```bash
npm run analyze_prd -- --file ~/Downloads/checkout-spec.pdf
```

**Why PDF over copy-paste:**
Claude receives the PDF as a file and reads it the way you would — tables stay as
tables, bullet points are understood as lists, headings and section structure are
preserved. If you copy-paste to `prd.md` instead, all of that structure is lost
and formatting artifacts can confuse the analysis.

If your PDF has embedded wireframes or diagrams, Claude sees those images too and
factors them into the test suggestions — you don't need to pass them separately.

> **Note:** This applies to "real" PDFs (exported from Word, PowerPoint, etc.).
> Scanned documents (a photo of a printed page saved as PDF) still work because
> Claude uses vision, but quality is lower.

---

### Images — wireframes, mockups, screenshots

Pass a single image as the main input:

```bash
npm run analyze_prd -- --file wireframe.png
```

Or add images alongside a text description with `--images`:

```bash
npm run analyze_prd -- --file prd.md --images wireframe.png,flow-diagram.jpg
```

Claude analyses the visual content — button labels, form fields, navigation
structure, error states shown in the design — alongside any text you provide.
Annotated mockups with labels and notes are especially useful.

Supported formats: `.png` `.jpg` `.jpeg` `.gif` `.webp`

---

### PowerPoint / Excel / Word

These binary formats are not read directly. Export to PDF first:

- **PowerPoint:** File → Export → Create PDF/XPS
- **Word:** File → Save As → PDF
- **Google Slides / Docs:** File → Download → PDF
- **Confluence / Notion:** Use the built-in PDF export

Then:
```bash
npm run analyze_prd -- --file ~/Downloads/your-spec.pdf
```

---

## Filtering output

By default the tool generates suggestions for every feature at every risk level.
Use filters when you want to scope the output to a specific sprint or priority.

### By risk tier

```bash
# Only critical tests
npm run analyze_prd -- --file prd.md --tier critical

# Critical and high only (most common — skip medium/low noise)
npm run analyze_prd -- --file prd.md --tier critical,high
```

### By feature area

```bash
# Only checkout-related tests
npm run analyze_prd -- --file prd.md --focus checkout

# Multiple areas
npm run analyze_prd -- --file prd.md --focus checkout,authentication,cart
```

### Combining filters

```bash
# High-priority checkout tests only — useful for a targeted sprint
npm run analyze_prd -- --file prd.md --tier critical,high --focus checkout
```

When filters are active they are noted in the header of `workspace/prd-tests.txt` so you
remember the scope of a given run.

---

## Output — `workspace/prd-tests.txt`

The tool writes `workspace/prd-tests.txt`. This file uses the same
`---`-separated batch format as `my-test.txt`, so `npm run generate` reads it
directly with no reformatting.

Each block looks like this:

```
# test_name: checkout-guest-happy-path
# spec_file: tests/e2e/place-order.spec.ts
# page_paths: /view_cart, /checkout, /payment
# source: direct
# risk: critical
# priority: critical
# reason: End-to-end purchase path for guest users — failure here means lost revenue.

Test that a guest user can complete a full purchase.
1. Add a product to the cart
2. Click Proceed To Checkout
3. Click Register / Login in the modal
4. Register a new account
5. Return to cart and proceed to checkout
6. Verify address details are shown
7. Enter a comment and click Place Order
8. Fill in payment details and confirm
9. Verify the order placed confirmation
```

The `# source:`, `# risk:`, `# priority:`, `# note:`, `# reason:`, `# source_ref:`,
and `# req_id:` lines are informational — they are treated as comments by the
generate tool and do not affect test generation.

**`# risk:`** — the intrinsic criticality of the *feature* being tested (critical/high/medium/low).

**`# priority:`** — the urgency to *write this test*. Matches risk by default. Can be higher when
the test covers the dominant user path while only an optional variant is tested, or when it
would be the only test for a given flow.

**`# note:`** — only present when priority diverges from risk; explains why.

**`# source: direct`** — maps to a specific named feature or endpoint in the source.
Omitting this test leaves a documented requirement uncovered.

**`# source: suggested`** — Claude's addition: a negative case, boundary condition, or
complementary scenario not explicitly mentioned in the source. Review before generating.

**`# source_ref:`** — for `direct` blocks traced to a numbered PRD item ("API 5",
"Test Case 3", "US-01", "Req-4"...), the verbatim numbering label. `none` for
`suggested` blocks or unnumbered sources.

**`# req_id:`** — a stable ID derived from `# source_ref` (e.g. "API 5" →
`REQ-API-005`), assigned automatically and recorded in `REQUIREMENTS.md`. `none`
when `# source_ref` is `none`.

**Ordering in the output file:**

1. All `direct` tests come first, then all `suggested` tests.
2. Within `direct`: if the source has numbered items (API 1, API 2, Test Case 3…),
   that order is preserved exactly. If not, tests are ordered by priority: critical → high → medium → low.
3. Within `suggested`: always ordered by priority: critical → high → medium → low.

---

## Requirements traceability — REQUIREMENTS.md

When a block traces back to a numbered PRD item, `analyze_prd` assigns it a stable
`REQ-NNN` / `REQ-<PREFIX>-NNN` ID (written as `# req_id:` in `workspace/prd-tests.txt`) and
appends a one-line description to `REQUIREMENTS.md` — a root-level, git-tracked,
append-only ledger.

- IDs are permanent once assigned — re-running `analyze_prd` against a revised PRD
  reuses the same ID for the same numbered item and adds zero new entries if nothing
  changed.
- Safe to hand-edit a description for clarity; do not renumber or remove existing
  entries.
- `suggested` blocks and `direct` blocks from an unnumbered source get
  `# req_id: none` — no fake granularity is invented for prose PRDs.

When a `# req_id`-bearing block is generated via `generate_test` (see
[generate-test.md](generate-test.md)), the resulting test's name is tagged
`@req:REQ-...`, making `REQUIREMENTS.md` entries greppable back to their covering
test(s).

Once `REQUIREMENTS.md` has entries, `analyze_coverage` and `npm run status` both
surface "requirements with zero covering tests" as a free, deterministic cross-check
— see [analyze-coverage.md](analyze-coverage.md#requirements-coverage-deterministic).

---

### Custom output file

```bash
npm run analyze_prd -- --file prd.md --output sprint-14-tests.txt
```

---

## Full workflow

```bash
# 1. Put your PRD in prd.md (or point at a PDF)
cp prd.md.example prd.md
# ... edit prd.md with your content ...

# 2. Generate the gap list
npm run analyze_prd -- --file prd.md --tier critical,high

# 3. Review workspace/prd-tests.txt
#    Delete the blocks you don't want, or reorder them

# 4. Generate the tests
npm run generate -- --file workspace/prd-tests.txt
```

---

## From Claude Code (MCP)

Paste PRD content directly into the chat:

```
Analyze this PRD and suggest test cases:

[paste your PRD text here]
```

With filters:

```
Analyze this PRD, only critical and high risk tests, focus on checkout:

[paste PRD text]
```

MCP parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `prd_content` | string | The PRD text (required) |
| `output_file` | string | Output path (default: `workspace/prd-tests.txt`) |
| `tier` | string[] | Risk tiers to include, e.g. `["critical", "high"]` |
| `focus` | string[] | Feature areas to include, e.g. `["checkout"]` |

> **Note:** The MCP tool only accepts text content. For PDF or image inputs,
> use the terminal CLI.
