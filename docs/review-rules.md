# review_rules

Read-only hygiene report for `learned-rules.md` and `framework-rules.md` — flags
stale rules (referencing POM classes/methods that no longer exist) and near-duplicate
rule pairs. `--promote <NNN>` mechanically moves a rule from `learned-rules.md` into
`framework-rules.md`, applying it to every project that uses this engine.

---

## When to run

Periodically, as `learned-rules.md` accumulates entries from `investigate_and_fix` —
or whenever a rule feels like it might be general-purpose rather than specific to this
project. `review_rules` (no args) is fully read-only; `--promote` is the only mode
that writes.

---

## What "stale" means

A rule is flagged stale if its text contains a `<SomePage>.method(...)` reference
(e.g. `BasePage.navigate(...)`) where:

- `SomePage` no longer exists in `pages/*.ts`, or
- `SomePage` exists but no longer has a method named `method`.

This cross-references the same POM Method Index `generate_test`/`plan_e2e` use
(`src/tools/pom-index.ts`).

**Limitation**: only `*Page.method(...)` references are checked. A rule that mentions
a CSS selector or locator that no longer appears anywhere in `pages/*.ts` is not
detected — the same best-effort scope `extractPomLocators` already documents. JS/TS
builtins (`JSON.parse(...)`, `Promise.all(...)`) never match — the pattern requires
the class name to end in `Page`.

---

## What "near-duplicate" means

Two rules (from `learned-rules.md` and/or `framework-rules.md`) are flagged as a
near-duplicate pair if the Jaccard similarity of their `problemClass` + `rule` prose
— lowercased, split on non-alphanumeric characters, words under 4 characters dropped
— is `>= 0.4`.

This is the same pattern that let three separate rules (004/024/025, all "a shared
CSS class causes a strict-mode locator collision") accumulate despite each one
slightly rewording the prose. `review_rules` doesn't merge or delete duplicates
automatically — it surfaces the pair so a human can consolidate them by hand.

---

## Promoting a rule

`review_rules --promote <NNN>`:

1. Removes `## Rule <NNN>` from `learned-rules.md` and renumbers the remaining
   entries sequentially (`001`, `002`, ...).
2. Appends it to `framework-rules.md` as the next `## FW-Rule <MMM>`, preserving its
   title, problem class, and rule text verbatim.

Which rules are worth promoting is **entirely a human judgment call** —
`review_rules` never suggests promotion candidates, only stale/near-duplicate hygiene
issues. A rule is a good promotion candidate if it's a general Playwright/QA lesson
any project would benefit from (e.g. "a shared CSS class across multiple elements
causes a strict-mode locator collision — scope to an ancestor"), and a poor one if
it's specific to this project's site or workarounds (e.g. a Cloudflare-bypass rule
tied to this project's `requestWithRetry` helper).

---

## `framework-rules.md`'s role

`src/prompts/framework-rules.md` ships with the engine (sibling to `system.ts`),
starting empty. `getSystemPrompt()` splices its rules in between `CORE_RULES` and the
project's own `learned-rules.md`:

```
CORE_RULES
---
## Framework rules (general lessons — apply to every project using this engine)
... promoted rules ...
---
## Learned rules (from past failure investigations — treat as mandatory)
... this project's learned-rules.md ...
```

While `framework-rules.md` is empty, the "Framework rules" section is omitted
entirely — `getSystemPrompt()`'s output is unchanged from before this tool existed.
Once a rule is promoted, it applies to **every** project using this engine, not just
the one it was promoted from.

---

## Usage

**MCP tool (Claude Code chat):**
```
review_rules
review_rules promote="15"
```

**CLI:**
```bash
npm run review_rules
npm run review_rules -- --promote 15
```

---

## Cost

None — pure file I/O and string comparison. No Claude/Ollama calls, no Playwright
run.
