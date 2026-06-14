# audit\_site

Crawls a site, identifies all distinct page types, analyses shared UI components,
recommends a POM hierarchy, and generates typed test data constants.

Run this **before writing any POMs** on a new project, or after a major site redesign.

---

## What it produces

| Output | File | When |
|--------|------|------|
| Structural audit | `site-audit-report.md` + `site-audit-report.json` | `--mode structure` or `--mode all` |
| Test data constants | `test-data/constants.ts` | `--mode data` or `--mode all` |

---

## Usage

```bash
# Full run — structure + test data (default, recommended for new projects)
npm run audit_site -- --url https://example.com

# Structure only — POM hierarchy analysis, no Claude API call
npm run audit_site -- --url https://example.com --mode structure

# Test data only — refresh constants.ts without re-crawling all page types
npm run audit_site -- --url https://example.com --mode data

# Custom report path
npm run audit_site -- --url https://example.com --output docs/pom-audit.md

# Limit page types discovered (default 20)
npm run audit_site -- --url https://example.com --max 30
```

---

## Structure output (`--mode structure`)

Crawls the site, fingerprints every page type, and writes:

- `site-audit-report.md` — human-readable matrix with hierarchy recommendation
- `site-audit-report.json` — machine-readable version read automatically by `generate_pom`

The report contains:
- All discovered page types with representative URLs
- **Universal elements** — present on every page → put in `SitePage` / `BasePage`
- **Partial-overlap groups** — shared by 2+ pages → intermediate class candidates
- Per-page element inventory (IDs, form inputs, structural classes)
- Recommended POM hierarchy

`generate_pom` reads `site-audit-report.json` automatically when generating POMs —
the page's unique IDs and form inputs are injected as hints into the LLM prompt,
improving locator selection without any manual work.

---

## Test data output (`--mode data`)

Crawls `/products` and `/login`, then calls Claude to generate `test-data/constants.ts`
with comprehensive test fixtures:

```typescript
/** Products extracted from the live catalogue */
export const PRODUCTS = [
  { id: 1, name: 'Blue Top', price: 500, category: 'Women' },
  ...
] as const;

/** Search terms — valid (returns results), invalid (returns empty), partial */
export const SEARCH = {
  valid: ['top', 'dress', 'jeans'],
  invalid: ['xyznotfound123', '!@#$%', 'zzzzaaa'],
  partial: ['to', 'je'],
} as const;

/** Registration/checkout fixture — email() is unique per call */
export const TEST_USER = {
  email: () => `qa_${Date.now()}@testmail.com`,
  password: 'SecureTest123!',
  name: 'QA Test User',
  // ... address, dob, mobile, etc.
};

/** Payment test data — expiryYear always 2 years in the future */
export const PAYMENT = {
  valid: {
    number: '4111111111111111',
    cvv: '123',
    expiryMonth: '12',
    get expiryYear() { return String(new Date().getFullYear() + 2); },
  },
};
```

Claude generates the file — it understands that:
- Search needs valid terms (from real product names), invalid terms (gibberish), and edge cases
- `TEST_USER.email` must be a function so each test run gets a unique address
- Card expiry must always be in the future
- User data should look realistic but be obviously fake

Re-run with `--mode data` when the product catalogue changes or test data needs refreshing.
The file is committed — contributors don't need to re-run it just to run tests.

---

## App knowledge candidates

Both modes also append observations to `workspace/APP_KNOWLEDGE_CANDIDATES.md` for
human review (see
[generate-app-knowledge](generate-app-knowledge.md#staging-area-workspaceapp_knowledge_candidatesmd)).
Structure mode notes the universal elements/partial-overlap groups found (a "Site
structure" entry, useful for spotting structural facts worth keeping in
`APP_KNOWLEDGE_MANUAL.md`); data mode flags when no search input is found on
`/products` (a "Search" entry, useful for confirming whether search genuinely doesn't
exist and recording it in `APP_LIMITATIONS.md`). Re-running the same mode against the
same URL replaces that source's section rather than duplicating it.

---

## Interpreting the structure output

**Universal elements** — IDs/classes present on every page. Belong in `SitePage` / `BasePage`.
Nav, footer, and subscription form inputs typically appear here.

**Partial-overlap groups** — shared by 2+ pages but not all. For each group:
1. Look at which page patterns share them
2. If testing 2+ pages in the group → create an intermediate class
3. If testing only 1 → leave locators in the concrete page class

**Unique elements** — anything in the per-page inventory not listed in the shared analysis.
These belong in the concrete page class only.

---

## Limitations

- Does not authenticate — only public pages are crawled
- Cookie consent overlays may block element detection on some pages
- For pages requiring login, supplement the report manually

---

## Recommended workflow for new projects

```
1. npm run audit_site -- --url https://target.com
   → site-audit-report.md  (read this — design your hierarchy)
   → site-audit-report.json (auto-used by generate_pom)
   → test-data/constants.ts (import in tests)

2. Write BasePage, SitePage, any intermediate classes by hand
   (informed by the shared-element analysis)

3. generate_pom /page-a /page-b /page-c
   → audit hints injected automatically → validated locators

4. generate_test
   → imports from test-data/constants.ts for stable test data
```
