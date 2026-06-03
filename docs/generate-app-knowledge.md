# generate_app_knowledge

Synthesises accumulated knowledge about the application into `APP_KNOWLEDGE.md` — a
per-feature risk document covering known app bugs, recurring coverage gaps, and risk
patterns. Once generated, `analyze_prd` and `analyze_coverage` read it automatically
to enrich their analysis with institutional knowledge about this specific app.

---

## When to run

Run after any of these events:
- A new app bug is recorded (after `investigate_and_fix` classifies a failure as an app bug)
- `analyze_coverage` or `analyze_prd` identifies new gaps (new rows in `GAPS_BACKLOG.md`)
- The coverage report is regenerated (`npm run analyze_coverage`)
- At the start of a new QA session to bring context current

---

## Sources

| Source | What it contributes |
|--------|---------------------|
| `TESTS_UI.md`, `TESTS_API.md`, `TESTS_E2E.md`, `TESTS_VISUAL.md` | App bug entries (kind: app_bug) — feature, root cause, actual behaviour |
| `GAPS_BACKLOG.md` | Open gap entries not yet resolved (no ✅, no ~~strikethrough~~) |
| `coverage-report.md` | First 2000 chars of the last coverage report — key risk findings |

---

## Output: `APP_KNOWLEDGE.md`

Grouped by feature area. Each section includes:

```markdown
## [Feature area]
**Risk level:** critical | high | medium | low
**App bugs:** [bullet list, or "none"]
**Open gaps:** [bullet list, or "none"]
**Notes:** [one-line pattern or warning for future analysis]
```

The file is auto-generated and **fully overwritten on every run**. Do not edit it
directly — use the sidecar file instead (see below).

---

## Persistent manual notes: `APP_KNOWLEDGE_MANUAL.md`

Create this file in the project root to add notes that survive every regeneration.
The tool reads it after synthesis and appends it verbatim at the end of
`APP_KNOWLEDGE.md`, separated by a `---` rule. The sidecar is **never touched** by
the tool — only read.

Use it for context that doesn't fit in a registry or backlog entry:
- Architectural quirks ("the cart API is stateless — each test must add items fresh")
- Cross-feature risk patterns ("checkout failures often originate in the auth flow")
- Testing constraints ("the payment sandbox rejects amounts > £999 in headless browsers")

```markdown
# Manual notes

## Checkout
- Payment sandbox rejects amounts > £999 in headless — cap test amounts at £50.
- Order confirmation email is async; allow up to 5s before asserting it was sent.
```

When the tool runs and finds `APP_KNOWLEDGE_MANUAL.md`, the output summary will show:
```
Manual notes: APP_KNOWLEDGE_MANUAL.md appended
```

---

## Usage

**MCP tool (Claude Code chat):**
```
generate_app_knowledge
```

Optional: specify a custom output path:
```
generate_app_knowledge output="path/to/custom.md"
```

**CLI:**
```bash
npm run generate_knowledge
npm run generate_knowledge -- --output path/to/custom.md
```

---

## Effect on other tools

`analyze_prd` and `analyze_coverage` call `readAppKnowledge()` at the start of every
run. If `APP_KNOWLEDGE.md` exists, its content is prepended to the Claude prompt as an
"App knowledge base" section. If the file doesn't exist, these tools behave exactly as
before.

This means running `generate_app_knowledge` once before a PRD analysis session will
cause Claude to weight test suggestions toward features with known defects or recurring
gap patterns — without any change to the prompt or the calling workflow.

---

## Cost

One Claude Sonnet 4.6 call. Typical input: a few hundred tokens of structured data.
Typical output: ~500–1000 tokens of synthesised Markdown. Cost is well under $0.01.
