# audit\_site

Crawls a site from its root URL, identifies all distinct page types, fingerprints
each one for shared UI components, and outputs a recommended POM hierarchy.

Run this **before writing any POMs** on a new project, or after a major site redesign.

---

## What it does

1. **Crawls** — starts from the given URL, collects all internal links
2. **Normalises** — groups URLs into patterns (`/product_details/1` → `/product_details/:id`,
   repeated string segments → `/brand_products/:slug`)
3. **Fingerprints** — visits one representative of each pattern, collecting element IDs,
   form inputs, structural CSS classes, and HTML5 landmarks
4. **Analyses** — computes which elements appear on ALL pages (SitePage candidates),
   which appear on 2+ pages (intermediate class candidates), and which are unique
5. **Reports** — writes `site-audit-report.md` with the full matrix and a hierarchy recommendation

---

## Usage

```bash
npm run audit_site -- --url https://example.com
npm run audit_site -- --url https://example.com --output docs/pom-audit.md
npm run audit_site -- --url https://example.com --max 30   # limit page types (default 20)
```

---

## Output

Console summary:
```
✅ Audit complete — 10 page types analysed
   Universal elements (#header, #footer, ...) → SitePage candidate
   3 partial-overlap group(s) → intermediate class candidate(s)

   Full report: site-audit-report.md
```

The report contains:
- All discovered page types with representative URLs and headings
- **Universal elements** — present on every page → put in `SitePage` / `BasePage`
- **Partial-overlap groups** — present on 2+ but not all pages → intermediate class candidates
- Per-page element inventory (IDs, form inputs, structural classes)
- Recommended POM hierarchy

---

## Interpreting the output

**Universal elements** — element IDs or structural classes present on every page type.
These belong in `SitePage` (or `BasePage` if no `SitePage` is planned). Nav IDs,
footer IDs, and subscription form inputs typically appear here.

**Partial-overlap groups** — elements shared by 2+ pages but not all. For each group:
1. Look at which page patterns share them
2. Ask: will we test all of those pages, or only one?
3. If testing 2+ pages in the group → create an intermediate class
4. If testing only 1 → leave the locators in the concrete page class for now

**Unique elements** — in the per-page inventory, any element not mentioned in the
shared analysis is unique to that page. It belongs in the concrete page class.

---

## Limitations

- Does not require authentication — only public pages are crawled
- Cookie consent overlays and pop-ups may block some element detection
- The component matrix is based on element IDs and CSS class names; semantically
  identical elements with different names across pages are not auto-merged
- For pages requiring login, add those URLs manually to supplement the report

---

## Workflow

```
Before starting a new project:
  npm run audit_site -- --url https://target.com
  → read site-audit-report.md
  → design hierarchy on paper
  → write BasePage, SitePage, intermediate classes by hand
  → update system prompt with hierarchy description
  → then start generating POMs and tests
```
