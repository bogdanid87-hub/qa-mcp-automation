# Examples — see the engine work on real projects

`qa-mcp-engine` generates and maintains Playwright tests by reading a project's existing suite
and matching its conventions. Everything here is **real captured output**, not mock-ups.

Start with the cross-project showcase — it's the fullest picture. The rest are raw, unedited
tool outputs you can read end to end.

## Flagship

| Example | What it shows |
|---|---|
| **[Cross-project showcase →](cross-project-showcase.md)** | One engine, three real Playwright repos (including one untouched for **five years**). The same prompt produces tests in each project's house style — and on my own suite, the generated test matches the one I'd written by hand. Plus five more tools (coverage, mock, auth, status, fix) run for real. |

## Worked tool outputs

| Tool | Example | What it proves |
|---|---|---|
| `analyze_prd` | [save-for-later](prd-analysis/save-for-later.prd.md) → [backlog](prd-analysis/save-for-later.backlog.txt) | Turns a feature PRD into a risk-tiered test backlog, and flags **cross-feature risks not stated in the PRD**. |
| `analyze_prd` | [dynamic-cart](prd-analysis/dynamic-cart.prd.md) → [backlog](prd-analysis/dynamic-cart.backlog.txt) | Classifies by risk and **correctly handles out-of-scope constraints** instead of testing them. |
| `analyze_coverage` | [subscription coverage report](coverage/subscription-coverage.md) | Finds gaps in an existing spec ranked by **priority vs risk**, and flags test asymmetries. |

Each `.prd.md` is the input; each `.backlog.txt` / report is the engine's output.

For what each tool does, see [docs/](../docs/) and [TOOLS.md](../TOOLS.md).
