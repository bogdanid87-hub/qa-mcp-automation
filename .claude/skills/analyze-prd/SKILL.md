---
name: analyze-prd
description: Reads a PRD (text, PDF, image, URL, or existing .spec.ts), classifies features by risk, and writes a backlog to workspace/prd-tests.txt for generate_test (analyze_prd MCP tool / npm run analyze_prd). Load when turning requirements/specs into a test plan, or discussing risk tiers.
---

# analyze_prd

Reads a PRD or feature description, classifies every feature by risk, and writes
`workspace/prd-tests.txt` — test case suggestions ready for
[generate-test](../generate-test/SKILL.md). Tests already recorded in the
registries are filtered out, so the output is a genuine gap list.

## When to use it

- Starting automation on a new feature/sprint and want a prioritised backlog
- Received a PRD in any format (Word, PowerPoint, Confluence, PDF) and want test
  cases quickly
- Want to know what's uncovered without reading the registries manually

## Risk tiers

| Tier | Meaning | Examples |
|------|--------------|---------|
| **critical** | Failure directly prevents a purchase or causes a financial error | Checkout, payment submission, cart totals, order confirmation |
| **high** | Failure erodes trust or surfaces wrong data | Login/registration, account management, order history, pricing |
| **medium** | Failure reduces purchase likelihood without blocking it | Search, filtering, navigation, product detail accuracy |
| **low** | Failure is visible but rarely causes abandonment | Static pages, newsletter, social links, error pages |

## Input formats (CLI)

```bash
# Existing spec — extracts test names, suggests what's missing
npm run analyze_prd -- --file tests/ui/cart.spec.ts

# URL — best for API docs; handles JS-rendered content
npm run analyze_prd -- --url https://automationexercise.com/api_list

# Text/Markdown
npm run analyze_prd -- --file prd.md   # cp prd.md.example prd.md to start

# PDF — recommended for polished specs (Word/PowerPoint/Confluence/Notion export to PDF)
# preserves tables, lists, headings, and embedded wireframe images
npm run analyze_prd -- --file ~/Downloads/checkout-spec.pdf

# Images — wireframes/mockups/screenshots (.png .jpg .jpeg .gif .webp)
npm run analyze_prd -- --file wireframe.png
npm run analyze_prd -- --file prd.md --images wireframe.png,flow-diagram.jpg
```

PowerPoint/Excel/Word are not read directly — export to PDF first.

## Filtering

```bash
npm run analyze_prd -- --file prd.md --tier critical,high          # by risk tier
npm run analyze_prd -- --file prd.md --focus checkout,cart          # by feature area
npm run analyze_prd -- --file prd.md --tier critical,high --focus checkout  # combined
```
Active filters are noted in `workspace/prd-tests.txt`'s header.

## Output — workspace/prd-tests.txt

Same `---`-separated batch format as `my-test.txt` — `npm run generate -- --file
workspace/prd-tests.txt` reads it directly. Each block:

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
...
```

`# source:`/`# risk:`/`# priority:`/`# note:`/`# reason:` are informational
comments — they don't affect generation.

- **`risk`** — intrinsic criticality of the feature (table above)
- **`priority`** — urgency to *write this test*; matches risk by default, can be
  higher (dominant path with only a variant tested, or the only test for a flow)
- **`note`** — only present when priority diverges from risk
- **`source: direct`** — traced to a specific named item in the source; omitting
  it leaves a documented requirement uncovered
- **`source: suggested`** — Claude's own addition (negative/edge/boundary case);
  review before generating
- **`source_ref`** / **`req_id`** — for `direct` blocks traced to a numbered PRD
  item ("API 5", "US-01"...), `req_id` is a stable `REQ-...` ID derived from
  `source_ref` and recorded in the root-level, append-only `REQUIREMENTS.md`
  ledger. Both are `none` for `suggested`/unnumbered blocks. When such a block is
  generated via [generate-test](../generate-test/SKILL.md), the resulting test is
  tagged `@req:REQ-...`, linking it back to its `REQUIREMENTS.md` entry.

**Ordering:** all `direct` first, then `suggested`. Within `direct`, numbered
source items keep their order; otherwise critical → high → medium → low. Within
`suggested`, always critical → high → medium → low.

```bash
npm run analyze_prd -- --file prd.md --output sprint-14-tests.txt   # custom output path
```

## Full workflow

```bash
cp prd.md.example prd.md   # or point at a PDF/URL
npm run analyze_prd -- --file prd.md --tier critical,high
# review workspace/prd-tests.txt — delete/reorder blocks
npm run generate -- --file workspace/prd-tests.txt
```

## MCP usage

Paste PRD content directly:

```
Analyze this PRD and suggest test cases:
[paste PRD text]

Analyze this PRD, only critical and high risk tests, focus on checkout:
[paste PRD text]
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `prd_content` | string | The PRD text (required unless `spec_path` is provided) |
| `spec_path` | string | Path to an existing `.spec.ts` — extracts test names, suggests additions |
| `output_file` | string | Output path (default `workspace/prd-tests.txt`) |
| `tier` | string[] | Risk tiers to include, e.g. `["critical", "high"]` |
| `focus` | string[] | Feature areas to include, e.g. `["checkout"]` |

> MCP only accepts text content or a spec path — for PDF/image inputs, use the terminal CLI.

Full guide: [docs/analyze-prd.md](../../../docs/analyze-prd.md)
