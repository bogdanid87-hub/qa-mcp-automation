---
name: learned-rules-loader
description: Loads learned-rules.md — lessons from real test-failure investigations that supplement CORE_RULES. Load when investigating a failing test, writing or reviewing a POM/spec, or asking "why does this convention exist".
---

# Learned Rules Loader

`learned-rules.md` (project root) is this project's rules discovered by
`investigate_and_fix` from real test failures on automationexercise.com. Each rule
is auto-appended after a fix and injected into the system prompt (CORE_RULES) for
every subsequent `generate_test` / `investigate_and_fix` call.

**Read the file directly** — `learned-rules.md` — for the current rule
set (entries are numbered, between `<!-- rules-start -->` and `<!-- rules-end -->`).

Each rule follows the same shape:

```
## Rule NNN — short title
**Problem class**: what went wrong and why (the symptom + root cause).
**Rule**: the concrete fix/convention to follow going forward.
```

## How this relates to CORE_RULES

- `src/prompts/system.ts` (CORE_RULES) is the static, hand-maintained rule set —
  see [qa-conventions](../qa-conventions/SKILL.md) for the human-facing summary.
- `learned-rules.md` is the dynamic, auto-appended supplement.
- When a learned rule's principle gets generalized into CORE_RULES (because the
  same problem class recurs), the learned-rules.md entry is removed — don't expect
  a 1:1 mapping between "things CORE_RULES covers" and "things learned-rules.md
  covers"; they're complementary, not overlapping.

This file is the file-management target for `investigate_and_fix` — do not edit it
manually (see [qa-conventions](../qa-conventions/SKILL.md#files-that-are-auto-managed--do-not-edit-manually)).

`learned-rules.md` lives at the project root, resolved via `process.cwd()` — so each
project's accumulated lessons live in that project's own repo, not inside this
package. No further change is needed when onboarding a new project: its
`learned-rules.md` is already scoped to it by virtue of living in its own root.
