# analyze\_prd

Reads a PRD or feature description, classifies every feature by risk, and writes
a `prd-tests.txt` file containing test case suggestions ready to feed into
`generate_test`. Tests already recorded in `TEST_CASES.md` are filtered out, so
the output is a genuine coverage gap list rather than a repeat of what's already built.

---

## When to use it

- Starting automation on a new feature or sprint and you want a prioritised backlog
- Received a PRD in any format (Word, PowerPoint, Confluence, PDF) and need to turn it into test cases quickly
- You want to know which scenarios haven't been covered yet without reading through `TEST_CASES.md` manually

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

When filters are active they are noted in the header of `prd-tests.txt` so you
remember the scope of a given run.

---

## Output — `prd-tests.txt`

The tool writes `prd-tests.txt` in the project root. This file uses the same
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

The `# source:`, `# risk:`, `# priority:`, `# note:`, and `# reason:` lines are
informational — they are treated as comments by the generate tool and do not affect test generation.

**`# risk:`** — the intrinsic criticality of the *feature* being tested (critical/high/medium/low).

**`# priority:`** — the urgency to *write this test*. Matches risk by default. Can be higher when
the test covers the dominant user path while only an optional variant is tested, or when it
would be the only test for a given flow.

**`# note:`** — only present when priority diverges from risk; explains why.

**`# source: direct`** — maps to a specific named feature or endpoint in the source.
Omitting this test leaves a documented requirement uncovered.

**`# source: suggested`** — Claude's addition: a negative case, boundary condition, or
complementary scenario not explicitly mentioned in the source. Review before generating.

**Ordering in the output file:**

1. All `direct` tests come first, then all `suggested` tests.
2. Within `direct`: if the source has numbered items (API 1, API 2, Test Case 3…),
   that order is preserved exactly. If not, tests are ordered by priority: critical → high → medium → low.
3. Within `suggested`: always ordered by priority: critical → high → medium → low.

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

# 3. Review prd-tests.txt
#    Delete the blocks you don't want, or reorder them

# 4. Generate the tests
npm run generate -- --file prd-tests.txt
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
| `output_file` | string | Output path (default: `prd-tests.txt`) |
| `tier` | string[] | Risk tiers to include, e.g. `["critical", "high"]` |
| `focus` | string[] | Feature areas to include, e.g. `["checkout"]` |

> **Note:** The MCP tool only accepts text content. For PDF or image inputs,
> use the terminal CLI.
