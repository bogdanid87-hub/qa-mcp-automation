---
name: plan-e2e
description: Plans a multi-page E2E journey before generating it (plan_e2e MCP tool) — decomposes the flow into POMs/methods and cross-references the POM Method Index for a step → view → POM → exists? → action checklist. Load when planning or discussing a multi-page E2E flow ahead of generate_test.
---

# plan_e2e

Plans a multi-page E2E journey **before** generating it. One Claude call decomposes
the flow into the POMs each step needs (`{poms: [{file, is_new, methods, page_url}]}`
— the same `PLAN_ONLY_HINT` shape `generate_test` uses internally), then
cross-references the real POM Method Index (`pages/*.ts`) to produce a
step → view → POM → exists? → action checklist. Writes no files.

## When to run

Before `generate_test` for any journey spanning more than one page. Use the
checklist to spot:

- **New POM** — `pom_exists: false`, action is "create with: ...".
- **New method on an existing POM** — `methods_to_add`, action is "add: ...".
- **Reuse** — a planned method already exists on a *different* POM class. The
  checklist flags it with `⚠️ reuse <Class>.<method>() (<file>) — do not add a
  forwarding alias`. Steer `generate_test` toward calling the existing method
  instead of duplicating it — this is the same forwarding-alias problem the
  [qa-workflow look-ahead check](../qa-workflow/SKILL.md#look-ahead-check-before-you-add-applies-to-your-own-direct-edits-too)
  guards against for direct edits.

## Usage

```
plan_e2e description="1. ... 2. ... 3. ..."
plan_e2e description="..." page_paths=["/products", "/view_cart", "/checkout"]
```

Chat-only — no CLI equivalent. One Claude Sonnet 4.6 call (capped at 2048 output
tokens).

Full guide: [docs/plan-e2e.md](../../../docs/plan-e2e.md)
