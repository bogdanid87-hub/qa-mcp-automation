---
name: review-rules
description: Lists stale and near-duplicate rules across learned-rules.md/framework-rules.md, and promotes a rule into framework-rules.md so it applies to every project (review_rules MCP tool / npm run review_rules). Load when reviewing or promoting learned rules.
---

# review_rules

Read-only hygiene report for `learned-rules.md` and `framework-rules.md` — flags
stale rules (referencing POM classes/methods that no longer exist) and near-duplicate
rule pairs. `--promote <NNN>` mechanically moves a rule from `learned-rules.md` into
`framework-rules.md`, applying it to every project that uses this engine.

## When to run

Periodically, as `learned-rules.md` accumulates entries from `investigate_and_fix` —
or whenever a rule looks general-purpose rather than specific to this project.

## Usage

```
review_rules
review_rules promote="15"
```

```bash
npm run review_rules
npm run review_rules -- --promote 15
```

## Key points

- **Stale** — a rule's `<SomePage>.method(...)` reference points at a class or method
  that no longer exists in `pages/*.ts` (checked against the POM Method Index). Only
  `*Page.method(...)` references are checked — stale selector references aren't
  detected.
- **Near-duplicate** — two rules' prose has Jaccard similarity `>= 0.4`. Surfaced for
  human consolidation, not auto-merged.
- **`--promote <NNN>`** is the only mode that writes: removes `## Rule NNN` from
  `learned-rules.md` (renumbering what remains) and appends it to
  `framework-rules.md` as the next `## FW-Rule`.
- **No promotion-candidate heuristic** — which rules are framework-worthy is 100%
  human judgment. `review_rules` only flags hygiene issues.
- `framework-rules.md` ships empty; while empty, `getSystemPrompt()` omits the
  "Framework rules" section entirely.

Full guide: [docs/review-rules.md](../../../docs/review-rules.md). Rule-file and
auto-managed-file conventions: [qa-conventions](../qa-conventions/SKILL.md).
