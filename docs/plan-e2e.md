# plan_e2e

Plans a multi-page E2E journey **before** generating it. Asks Claude to decompose the
flow into the Page Object Models each step needs — same shape `generate_test` uses
internally for complex flows — then cross-references the real POM Method Index to
produce a step → view → POM → exists? → action checklist. Writes no files.

---

## When to run

Before calling `generate_test` for a journey that spans more than one page (e.g.
"search for a product, add it to the cart, go to checkout, place the order"). The
checklist tells you, per step:

- Does the POM for that page already exist?
- Which methods genuinely need to be written?
- Does a planned method already exist on a *different* POM class — i.e. should
  `generate_test` reuse it instead of creating a near-duplicate (a forwarding alias)?

Reviewing this before generation catches reuse opportunities and scope surprises
without spending tokens on a full spec + POM generation pass.

---

## How it works

1. Builds focused context for the description (existing POMs/fixtures whose names
   match feature keywords) — the same context `generate_test` uses.
2. Optionally inspects `page_paths` live for DOM context.
3. One Claude call using `PLAN_ONLY_HINT` — the same planning prompt
   `generate_test` uses internally — asking for
   `{poms: [{file, is_new, methods, page_url}]}`.
4. Cross-references that plan against the real **POM Method Index**
   (`getPomIndex()` over `pages/*.ts`):
   - `file` not found on disk → `pom_exists: false` (new POM).
   - A planned method that already exists on `file` → no action.
   - A planned method that exists on a *different* POM class → flagged under
     `reuse`, with the existing class/file — `generate_test` should call that
     method rather than duplicating it.
   - Anything else → `methods_to_add`.
5. Renders the result as a markdown table — no files written, no spec generated.

---

## Output

```markdown
### E2E Plan Checklist

| Step | View | POM | Exists? | Action |
|---|---|---|---|---|
| 1 | /products | `pages/ProductsPage.ts` | yes | no changes needed — all methods already exist |
| 2 | /view_cart | `pages/ViewCartPage.ts` | yes | add: applyCouponCode |
| 3 | /checkout | `pages/CheckoutPage.ts` | no | create with: fillDeliveryAddress, clickPlaceOrder |
```

A reuse warning looks like:

```
⚠️ reuse ProductsPage.getCardPrice() (pages/ProductsPage.ts) — do not add a forwarding alias
```

---

## Usage

**MCP tool (Claude Code chat):**
```
plan_e2e description="1. Search for a product on the products page. 2. Add it to the cart. 3. Go to view cart and apply a coupon. 4. Proceed to checkout and place the order."
```

Optional: pass `page_paths` to inspect live pages for more accurate plans:
```
plan_e2e description="..." page_paths=["/products", "/view_cart", "/checkout"]
```

No terminal/CLI equivalent — planning is a chat-only step ahead of `generate_test`.

---

## Cost

One Claude Sonnet 4.6 call, capped at 2048 output tokens — same cost class as the
internal `PLAN_ONLY_HINT` pass `generate_test` already makes for complex flows.
