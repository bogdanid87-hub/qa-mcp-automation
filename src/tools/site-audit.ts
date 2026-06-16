import { WORKSPACE_PATHS, ensureWorkspace } from '../workspace.js';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { safeWrite } from '../lib/safe-write.js';
import { appendKnowledgeCandidates } from './generate-app-knowledge.js';
import { config } from '../config.js';

const ROOT = process.cwd();

export interface SiteAuditArgs {
  url: string;
  output?: string;
  maxPageTypes?: number;
  /** structure = site-audit-report only; data = test-data/constants.ts only; all = both (default) */
  mode?: 'structure' | 'data' | 'all';
}

export interface PageTypeInfo {
  pattern: string;
  representative: string;
  ids: string[];
  formInputIds: string[];
  structuralClasses: string[];
  headings: string[];
  landmarks: string[];
}

export interface AuditResult {
  baseUrl: string;
  pageTypes: PageTypeInfo[];
  // Presence maps: element → list of page patterns that have it
  idPresence: Map<string, string[]>;
  classPresence: Map<string, string[]>;
}

// Replace numeric path segments with :id, and repeated same-prefix segments with :slug
function toPattern(href: string, base: string): string {
  const path = href.replace(base.replace(/\/$/, ''), '').replace(/\/+$/, '') || '/';
  return path.replace(/\/\d+/g, '/:id');
}

// After collecting all patterns, merge ones that share a prefix and only differ in the last
// segment (e.g. /brand_products/Polo and /brand_products/H%26M → /brand_products/:slug)
function mergeSlugPatterns(patternMap: Map<string, string>): Map<string, string> {
  const prefixCounts = new Map<string, string[]>();
  for (const pattern of patternMap.keys()) {
    const lastSlash = pattern.lastIndexOf('/');
    if (lastSlash <= 0) continue;
    const prefix = pattern.slice(0, lastSlash);
    const segment = pattern.slice(lastSlash + 1);
    if (segment === ':id') continue; // already normalised
    if (!prefixCounts.has(prefix)) prefixCounts.set(prefix, []);
    prefixCounts.get(prefix)!.push(pattern);
  }
  const merged = new Map(patternMap);
  for (const [prefix, patterns] of prefixCounts) {
    if (patterns.length >= 2) {
      const slugPattern = `${prefix}/:slug`;
      if (!merged.has(slugPattern)) {
        // Keep the first representative URL
        merged.set(slugPattern, merged.get(patterns[0])!);
      }
      for (const p of patterns) merged.delete(p);
    }
  }
  return merged;
}

function normaliseBase(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

// Collect structural fingerprint of the currently loaded page
async function fingerprint(page: any): Promise<Omit<PageTypeInfo, 'pattern' | 'representative'>> {
  const data = await page.evaluate((): {
    ids: string[]; formInputIds: string[]; structuralClasses: string[];
    headings: string[]; landmarks: string[];
  } => {
    // IDs — filter out auto-generated / purely numeric ones
    const ids: string[] = [];
    document.querySelectorAll('[id]').forEach((el: Element) => {
      const id = (el as HTMLElement).id;
      if (id && id.length > 1 && !(/^\d+$/.test(id)) && !(/^[a-f0-9]{8}-/.test(id))) {
        ids.push(id);
      }
    });

    // Form input IDs / names — useful for identifying forms
    const formInputIds: string[] = [];
    document.querySelectorAll('input[id], input[name], textarea[id], textarea[name]').forEach((el: Element) => {
      const key = (el as HTMLInputElement).id || (el as HTMLInputElement).name;
      if (key && key.length > 1 && !formInputIds.includes(key)) formInputIds.push(key);
    });

    // Structural classes from header/footer/nav/sidebar regions
    const structuralClasses: string[] = [];
    const seen = new Set<string>();
    const regions = document.querySelectorAll(
      'header, #header, footer, #footer, nav, .navbar, aside, .sidebar, .left-sidebar, ' +
      'body > div > div, #wrapper > div, .container-fluid > div'
    );
    regions.forEach((el: Element) => {
      el.classList.forEach((c: string) => {
        if (c.length > 2 && !seen.has(c) &&
            !/^(col-|row$|container|clearfix|active|open|show|hide|d-|g-|m-|p-|text-|btn$|sr-)/.test(c)) {
          seen.add(c);
          structuralClasses.push(c);
        }
      });
    });

    // Page headings — good signal for what the page is about
    const headings: string[] = [];
    document.querySelectorAll('h1, h2').forEach((h: Element) => {
      const t = h.textContent?.trim() ?? '';
      if (t && t.length < 80) headings.push(t);
    });

    // HTML5 landmark elements present
    const landmarks: string[] = ['header', 'nav', 'main', 'aside', 'footer', 'section', 'article']
      .filter(tag => document.querySelector(tag) !== null);

    return { ids, formInputIds, structuralClasses, headings, landmarks };
  });

  return data;
}

export async function runSiteAudit(args: SiteAuditArgs): Promise<AuditResult> {
  const maxTypes = args.maxPageTypes ?? 20;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  // ── Step 1: Crawl from root to discover all internal URLs ──────────────────
  process.stdout.write('  Crawling internal links...\n');
  const crawlPage = await ctx.newPage();
  await crawlPage.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await crawlPage.waitForTimeout(2000);
  const actualBase = normaliseBase(crawlPage.url()); // resolve www/non-www redirects

  const allHrefs: string[] = await crawlPage.evaluate((base: string) => {
    return [...new Set(
      [...document.querySelectorAll('a[href]')]
        .map(a => (a as HTMLAnchorElement).href)
        .filter(h => h && h.startsWith(base) && !h.includes('#') && !h.match(/\.(pdf|zip|png|jpg|gif|css|js)$/i))
    )];
  }, actualBase);

  await crawlPage.close();
  process.stdout.write(`  Found ${allHrefs.length} internal URLs\n`);

  // ── Step 2: Deduplicate into page-type patterns ────────────────────────────
  const patternMap = new Map<string, string>(); // pattern → first representative URL
  patternMap.set('/', actualBase);               // always include root (post-redirect URL)
  for (const href of allHrefs) {
    const pattern = toPattern(href, actualBase);
    if (!patternMap.has(pattern)) {
      patternMap.set(pattern, href);
      if (patternMap.size >= maxTypes) break;
    }
  }

  const mergedMap = mergeSlugPatterns(patternMap);
  // Rewrite patternMap in place
  for (const key of [...patternMap.keys()]) patternMap.delete(key);
  for (const [k, v] of mergedMap) patternMap.set(k, v);

  process.stdout.write(`  Identified ${patternMap.size} distinct page types\n`);

  // ── Step 3: Visit one representative of each type and fingerprint it ───────
  const pageTypes: PageTypeInfo[] = [];
  let i = 0;
  for (const [pattern, representative] of patternMap) {
    i++;
    process.stdout.write(`  [${i}/${patternMap.size}] ${pattern}\n`);
    const p = await ctx.newPage();
    try {
      await p.goto(representative, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForTimeout(1000);
      const fp = await fingerprint(p);
      pageTypes.push({ pattern, representative, ...fp });
    } catch (err) {
      process.stdout.write(`    ⚠️  Error: ${(err as Error).message}\n`);
      pageTypes.push({
        pattern, representative, ids: [], formInputIds: [],
        structuralClasses: [], headings: [], landmarks: [],
      });
    } finally {
      await p.close();
    }
  }

  await browser.close();

  // ── Step 4: Compute presence maps ─────────────────────────────────────────
  const idPresence = new Map<string, string[]>();
  const classPresence = new Map<string, string[]>();

  for (const pt of pageTypes) {
    for (const id of pt.ids) {
      if (!idPresence.has(id)) idPresence.set(id, []);
      idPresence.get(id)!.push(pt.pattern);
    }
    for (const cls of pt.structuralClasses) {
      if (!classPresence.has(cls)) classPresence.set(cls, []);
      classPresence.get(cls)!.push(pt.pattern);
    }
  }

  return { baseUrl: args.url, pageTypes, idPresence, classPresence };
}

function buildReport(result: AuditResult): string {
  const { pageTypes, idPresence, classPresence } = result;
  const total = pageTypes.length;

  const lines: string[] = [
    `# Site Audit — ${result.baseUrl}`,
    `*Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}*`,
    '',
    `## Discovered page types (${total})`,
    '',
    ...pageTypes.map(pt =>
      `- \`${pt.pattern}\`  \n` +
      `  Representative: ${pt.representative}  \n` +
      (pt.headings.length ? `  Headings: ${pt.headings.slice(0, 3).join(' / ')}  \n` : '') +
      (pt.formInputIds.length ? `  Form inputs: \`${pt.formInputIds.slice(0, 6).join('`, `')}\`` : '')
    ),
    '',
    '---',
    '',
    '## Shared element analysis',
    '',
    '### Universal — present on ALL page types → BasePage / SitePage',
    '',
  ];

  const universal = [...idPresence.entries()]
    .filter(([, pages]) => pages.length === total)
    .map(([id]) => id)
    .sort();
  const universalClasses = [...classPresence.entries()]
    .filter(([, pages]) => pages.length === total)
    .map(([cls]) => cls)
    .sort();

  if (universal.length) lines.push('**IDs:** ' + universal.map(id => `\`#${id}\``).join(', '));
  else lines.push('*(no IDs universal across all pages)*');
  if (universalClasses.length) lines.push('\n**Classes:** ' + universalClasses.map(c => `\`.${c}\``).join(', '));
  lines.push('');

  // Shared across 2+ but not all pages
  const byCount = new Map<number, { ids: string[]; classes: string[] }>();
  for (let n = total - 1; n >= 2; n--) {
    const ids = [...idPresence.entries()]
      .filter(([, pages]) => pages.length === n)
      .map(([id]) => id)
      .sort();
    const classes = [...classPresence.entries()]
      .filter(([, pages]) => pages.length === n)
      .map(([cls]) => cls)
      .sort();
    if (ids.length || classes.length) byCount.set(n, { ids, classes });
  }

  lines.push(`### Partially shared → intermediate class candidates`);
  lines.push('');
  if (byCount.size === 0) {
    lines.push('*(no partially-shared elements found)*');
  } else {
    for (const [n, { ids, classes }] of [...byCount.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(`**Present on ${n}/${total} pages:**`);
      // Show which pages
      const affectedPatterns = ids.length
        ? idPresence.get(ids[0])!
        : classPresence.get(classes[0])!;
      lines.push(`Pages: ${affectedPatterns.map(p => `\`${p}\``).join(', ')}`);
      if (ids.length) lines.push('IDs: ' + ids.map(id => `\`#${id}\``).join(', '));
      if (classes.length) lines.push('Classes: ' + classes.map(c => `\`.${c}\``).join(', '));
      lines.push('');
    }
  }

  // ── Page-type details matrix ────────────────────────────────────────────────
  lines.push('---', '', '## Per-page element inventory', '');
  for (const pt of pageTypes) {
    lines.push(`### \`${pt.pattern}\``);
    lines.push(`URL: ${pt.representative}`);
    if (pt.headings.length) lines.push(`Headings: ${pt.headings.join(' / ')}`);
    if (pt.landmarks.length) lines.push(`Landmarks: ${pt.landmarks.join(', ')}`);
    if (pt.ids.length) lines.push(`IDs: ${pt.ids.map(id => `\`#${id}\``).join(', ')}`);
    if (pt.formInputIds.length) lines.push(`Form inputs: ${pt.formInputIds.map(i => `\`${i}\``).join(', ')}`);
    if (pt.structuralClasses.length) lines.push(`Structural classes: ${pt.structuralClasses.slice(0, 12).map(c => `\`.${c}\``).join(', ')}`);
    lines.push('');
  }

  // ── Recommended hierarchy ───────────────────────────────────────────────────
  lines.push('---', '', '## Recommended POM hierarchy', '');
  lines.push('Based on the shared-element analysis above:');
  lines.push('');
  lines.push('```');
  lines.push('BasePage          (navigate, popup handling — no locators)');
  if (universal.length || universalClasses.length) {
    lines.push('  └── SitePage  (universal elements: nav, footer, logged-in indicator)');
    lines.push('        ├── [page-specific classes extend SitePage]');
  }
  if (byCount.size > 0) {
    for (const [n, { ids }] of [...byCount.entries()].sort((a, b) => b[0] - a[0])) {
      const pagesAffected = ids.length ? idPresence.get(ids[0])! : [];
      lines.push(`        └── IntermediatePage  (${n} pages share: ${pagesAffected.join(', ')})`);
      lines.push(`              └── [specific page classes]`);
    }
  }
  lines.push('```');
  lines.push('');
  lines.push('> Run `inspect_page` on the URLs listed under each candidate group to verify');
  lines.push('> locator selectors before implementing the hierarchy.');

  // Update the inspect_page tip now that generate_pom reads audit JSON automatically
  lines.push('');
  lines.push('> **generate_pom** reads `site-audit-report.json` automatically — audit hints are');
  lines.push('> injected into every POM generation call for pages listed above. Run `inspect_page`');
  lines.push('> only if you want to manually explore a page\'s DOM before generating a POM.');

  return lines.join('\n');
}

// ── JSON output ──────────────────────────────────────────────────────────────

export interface SiteAuditJson {
  generatedAt: string;
  siteUrl: string;
  pageTypes: number;
  /** IDs present on EVERY page — owned by BasePage/SitePage, never re-declare in page POMs */
  universalIds: string[];
  universalClasses: string[];
  pages: Array<{
    /** URL pattern with :id / :slug wildcards, e.g. "/product_details/:id" */
    pattern: string;
    /** A real URL that represents this page type */
    representative: string;
    /** Page-specific IDs only — universals already excluded */
    uniqueIds: string[];
    /** Form input names unique to this page — universals + noise excluded */
    uniqueFormInputs: string[];
    headings: string[];
    structuralClasses: string[];
  }>;
}

// IDs / inputs that appear everywhere and are owned by parent classes.
const JSON_NOISE = new Set([
  'susbscribe_email', 'subscribe', 'success-subscribe',
  'header', 'footer', 'scrollUp', 'aswift_0_host',
  'csrfmiddlewaretoken',
]);

function isJsonNoise(s: string): boolean {
  return JSON_NOISE.has(s) || /^fc-preference-|^fc-focus-trap|^aswift_/.test(s);
}

function buildJson(result: AuditResult): SiteAuditJson {
  const { pageTypes, idPresence, classPresence } = result;
  const total = pageTypes.length;

  const universalIds = [...idPresence.entries()]
    .filter(([, pages]) => pages.length === total)
    .map(([id]) => id)
    .sort();
  const universalClasses = [...classPresence.entries()]
    .filter(([, pages]) => pages.length === total)
    .map(([cls]) => cls)
    .sort();
  const universalIdSet = new Set(universalIds);

  return {
    generatedAt: new Date().toISOString(),
    siteUrl: result.baseUrl,
    pageTypes: total,
    universalIds: universalIds.filter(id => !isJsonNoise(id)),
    universalClasses: universalClasses.filter(c => !isJsonNoise(c)),
    pages: pageTypes.map(pt => ({
      pattern: pt.pattern,
      representative: pt.representative,
      uniqueIds: pt.ids.filter(id => !universalIdSet.has(id) && !isJsonNoise(id)),
      uniqueFormInputs: pt.formInputIds.filter(f => !isJsonNoise(f)),
      headings: pt.headings,
      structuralClasses: pt.structuralClasses,
    })),
  };
}

// ── Test data collection ─────────────────────────────────────────────────────

interface RawTestData {
  baseUrl: string;
  products: Array<{ id: number; name: string; price: string; category: string }>;
  categories: string[];
  subcategories: Record<string, string[]>;
  searchExists: boolean;
  registrationFields: Array<{ name: string; type: string; placeholder: string }>;
}

async function collectRawTestData(baseUrl: string): Promise<RawTestData> {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  try {
    process.stdout.write('  Collecting product catalogue...\n');
    const productsPage = await ctx.newPage();
    await productsPage.goto(`${baseUrl}/products`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await productsPage.waitForTimeout(1500);

    const { products, categories, subcategories, searchExists } = await productsPage.evaluate(() => {
      const productCards: Array<{ id: number; name: string; price: string; category: string }> = [];
      document.querySelectorAll('.productinfo.text-center').forEach(card => {
        const wrapper = card.closest('.product-image-wrapper');
        const link = wrapper?.querySelector('a[href*="/product_details/"]') as HTMLAnchorElement | null;
        const idMatch = link?.getAttribute('href')?.match(/\/product_details\/(\d+)/);
        const name = card.querySelector('p')?.textContent?.trim() ?? '';
        const price = card.querySelector('h2')?.textContent?.trim() ?? '';
        if (idMatch && name) productCards.push({ id: parseInt(idMatch[1]), name, price, category: '' });
      });

      const cats: string[] = [];
      const subs: Record<string, string[]> = {};
      document.querySelectorAll('#accordian .panel').forEach(panel => {
        const catName = panel.querySelector('.panel-title a')?.textContent?.trim() ?? '';
        if (!catName) return;
        cats.push(catName);
        subs[catName] = [];
        panel.querySelectorAll('.panel-body a').forEach(a => {
          const sub = a.textContent?.trim();
          if (sub) subs[catName].push(sub);
        });
      });

      return {
        products: productCards.slice(0, 30),
        categories: cats,
        subcategories: subs,
        searchExists: !!document.querySelector('#search_product'),
      };
    });

    await productsPage.close();

    process.stdout.write('  Collecting registration form fields...\n');
    const loginPage = await ctx.newPage();
    await loginPage.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await loginPage.waitForTimeout(1000);

    const registrationFields = await loginPage.evaluate(() => {
      const fields: Array<{ name: string; type: string; placeholder: string }> = [];
      document.querySelectorAll('.signup-form input, .login-form input').forEach(el => {
        const input = el as HTMLInputElement;
        if (input.type === 'submit' || input.type === 'button') return;
        const name = input.name || input.id || input.placeholder;
        if (name) fields.push({ name, type: input.type || 'text', placeholder: input.placeholder || '' });
      });
      return fields;
    });

    await loginPage.close();
    return { baseUrl, products, categories, subcategories, searchExists, registrationFields };
  } finally {
    await browser.close();
  }
}

async function generateConstants(
  raw: RawTestData,
  apiKey: string,
  existingContent?: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const productNames = raw.products.map(p => p.name).filter(Boolean);

  // Extract existing product IDs so Claude knows what's already covered
  const existingIds = existingContent
    ? [...existingContent.matchAll(/id:\s*(\d+)/g)].map(m => parseInt(m[1]))
    : [];
  const newProducts = raw.products.filter(p => !existingIds.includes(p.id));

  const isMerge = !!existingContent && existingIds.length > 0;

  const mergeInstructions = isMerge ? `
## MERGE MODE — existing constants.ts shown below
This file already has ${existingIds.length} product IDs: [${existingIds.slice(0, 10).join(', ')}${existingIds.length > 10 ? '...' : ''}].

Rules:
- PRODUCTS: add ONLY the ${newProducts.length} new products (IDs not already present). Keep all existing entries unchanged.
- CATEGORIES / SUBCATEGORIES: update if new categories were found, otherwise keep as-is.
- SEARCH: you may extend valid/partial with new terms, but never remove existing ones.
- TEST_USER: COPY EXACTLY as it appears below — do not change any values. The user may have customised these.
- PAYMENT: COPY EXACTLY as it appears below — do not change any values.

## Existing constants.ts
\`\`\`typescript
${existingContent}
\`\`\`` : '';

  const freshInstructions = !isMerge ? `
## Generate these exports

1. PRODUCTS — all products as "as const" typed array, price as number (strip currency symbol)
2. CATEGORIES — top-level category string array, "as const"
3. SUBCATEGORIES — Record<string, readonly string[]> mapping category to subcategory list
4. SEARCH — object with:
   - valid: string[] — 3-5 single words from real product names (${productNames.slice(0, 3).join(', ')}...) that will return search results
   - invalid: string[] — 3-4 strings guaranteed to return ZERO results (nonsense like 'xyznotfound123', 'zzzzaaa', '!@#$%')
   - partial: string[] — 2-3 partial words (first 2-3 chars of product names) that return multiple results
5. TEST_USER — registration/checkout test fixture:
   - email: () => \`qa_\${Date.now()}_\${Math.random().toString(36).slice(2, 7)}@testmail.com\`  ← timestamp + random suffix, safe for parallel test runs
   - password, name, firstName, lastName, address, city, state, country, mobile, zipCode
   - dob: { day: '15', month: 'January', year: '1990' }
   - Use realistic but obviously fake values. Do NOT use "as const" (email is a function).
6. PAYMENT — payment test data:
   - valid: { name, number: '4111111111111111', cvv: '123', expiryMonth: '12' }
   - valid.expiryYear: use a getter — get expiryYear() { return String(new Date().getFullYear() + 2); }
     This MUST always be in the future — never hardcode a year.
7. REVIEW — fixture for review/feedback forms (product reviews, contact forms):
   - name: string (same as TEST_USER.name)
   - email: string (a fixed address, NOT a function — review submissions don't need uniqueness)
   - text: a short, realistic but obviously fake review sentence (1-2 sentences)` : '';

  const message = await client.messages.create({
    model: config.models.primary,
    max_tokens: 3000,
    system: 'You are managing a TypeScript test data constants file. Output ONLY valid TypeScript — no markdown, no explanation, no code fences.',
    messages: [{
      role: 'user',
      content: `${isMerge ? 'Update' : 'Generate'} test-data/constants.ts for automated testing of: ${raw.baseUrl}

## Crawled data (${isMerge ? `${newProducts.length} new products not yet in constants` : `${raw.products.length} products total`})
${JSON.stringify(isMerge ? newProducts.slice(0, 20) : raw.products.slice(0, 15), null, 2)}

Categories: ${raw.categories.join(', ')}
Subcategories: ${JSON.stringify(raw.subcategories)}
${freshInstructions}${mergeInstructions}

File must start with: // Auto-generated by audit_site — re-run with --mode data to refresh.
Add JSDoc comments on each export.`,
    }],
  });

  const generated = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .replace(/^```(?:typescript|ts)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  // Safety guard: if the merge dropped TEST_USER or PAYMENT (which Claude should never do),
  // extract them from the existing file and append them.
  if (existingContent) {
    const missing: string[] = [];
    if (!/export const TEST_USER/.test(generated)) missing.push('TEST_USER');
    if (!/export const PAYMENT/.test(generated)) missing.push('PAYMENT');
    if (!/export const REVIEW/.test(generated) && /export const REVIEW/.test(existingContent)) missing.push('REVIEW');

    if (missing.length > 0) {
      process.stderr.write(`[audit_site] ⚠️  Claude dropped ${missing.join(', ')} — restoring from existing file\n`);
      const preserved = missing.map(name => {
        // Extract the export block from existingContent
        const start = existingContent.indexOf(`export const ${name}`);
        if (start === -1) return '';
        // Find the end of the export (next export or end of file)
        const next = existingContent.indexOf('\nexport const', start + 1);
        return existingContent.slice(start, next === -1 ? undefined : next).trim();
      }).filter(Boolean);
      return `${generated}\n\n${preserved.join('\n\n')}`;
    }
  }

  return generated;
}

export async function siteAuditTool(args: SiteAuditArgs): Promise<string> {
  await ensureWorkspace();
  const mdPath = args.output ?? WORKSPACE_PATHS.siteAuditReport;
  const jsonPath = mdPath.replace(/\.md$/, '.json');
  const mode = args.mode ?? 'all';
  const lines: string[] = [];

  // ── Structure ────────────────────────────────────────────────────────────
  if (mode === 'structure' || mode === 'all') {
    process.stdout.write(`\n🔍 Site audit: ${args.url}\n\n`);
    const result = await runSiteAudit(args);

    const report = buildReport(result);
    const json = buildJson(result);
    await Promise.all([
      safeWrite(mdPath, report, { allowOverwrite: true }),
      safeWrite(jsonPath, JSON.stringify(json, null, 2), { allowOverwrite: true }),
    ]);

    const total = result.pageTypes.length;
    const universalIds = [...result.idPresence.entries()]
      .filter(([, p]) => p.length === total).map(([id]) => id);
    const universalClasses = [...result.classPresence.entries()]
      .filter(([, p]) => p.length === total).map(([cls]) => cls);
    const sharedGroups = [...new Set(
      [...result.idPresence.entries()]
        .filter(([, p]) => p.length >= 2 && p.length < total)
        .map(([, p]) => p.sort().join(','))
    )].length;

    lines.push(
      `\n✅ Structure audit complete — ${total} page types analysed`,
      `   Universal elements (#${universalIds.slice(0, 4).join(', #')}${universalIds.length > 4 ? '...' : ''}) → SitePage candidate`,
      sharedGroups > 0 ? `   ${sharedGroups} partial-overlap group(s) → intermediate class candidate(s)` : '',
      `\n   Markdown report : ${mdPath}`,
      `   Machine-readable: ${jsonPath}`,
    );

    const structureNote = (universalIds.length || universalClasses.length)
      ? `Universal elements across all ${total} page types: ` +
        [...universalIds.map(id => `#${id}`), ...universalClasses.map(c => `.${c}`)].join(', ') + '.'
      : `No elements are universal across all ${total} page types.`;

    await appendKnowledgeCandidates(
      [{
        area: 'Site structure',
        note: `${structureNote} ${sharedGroups} partial-overlap group(s). See site-audit-report.md ` +
          `for the full POM hierarchy recommendation — review for anything that suggests a ` +
          `missing/limited feature (record in APP_LIMITATIONS.md) or a structural fact worth ` +
          `keeping (APP_KNOWLEDGE_MANUAL.md).`,
      }],
      `audit_site — ${args.url} (structure)`,
      new Date().toISOString().slice(0, 10),
    );
    lines.push(`   Knowledge candidate appended to: workspace/APP_KNOWLEDGE_CANDIDATES.md`);
  }

  // ── Test data ─────────────────────────────────────────────────────────────
  if (mode === 'data' || mode === 'all') {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      lines.push('\n⚠️  ANTHROPIC_API_KEY not set — skipping test data generation');
    } else {
      const base = normaliseBase(args.url);
      process.stdout.write(`\n📦 Collecting test data from ${base}...\n`);

      const raw = await collectRawTestData(base);
      process.stdout.write(`  Found ${raw.products.length} products, ${raw.categories.length} categories\n`);

      if (!raw.searchExists) {
        await appendKnowledgeCandidates(
          [{
            area: 'Search',
            note: 'No #search_product element found on /products — search functionality ' +
              'may not exist, or this site uses a different selector/page for search. ' +
              'Confirm and record in APP_LIMITATIONS.md if genuinely absent.',
          }],
          `audit_site — ${base} (data)`,
          new Date().toISOString().slice(0, 10),
        );
        lines.push(`   ⚠️  No search input found — candidate noted in APP_KNOWLEDGE_CANDIDATES.md`);
      }

      const constantsPath = join(ROOT, 'test-data', 'constants.ts');

      // Read existing constants.ts to enable merge mode
      let existingContent: string | undefined;
      try {
        existingContent = await readFile(constantsPath, 'utf-8');
        const existingIds = [...existingContent.matchAll(/id:\s*(\d+)/g)].map(m => parseInt(m[1]));
        const newCount = raw.products.filter(p => !existingIds.includes(p.id)).length;
        process.stdout.write(`  Existing constants: ${existingIds.length} products — ${newCount} new to add\n`);
        process.stdout.write('  Merging constants with Claude...\n');
      } catch {
        process.stdout.write('  No existing constants.ts — generating fresh\n');
        process.stdout.write('  Generating constants with Claude...\n');
      }

      const constants = await generateConstants(raw, apiKey, existingContent);
      await mkdir(dirname(constantsPath), { recursive: true });
      await safeWrite(constantsPath, constants, { allowOverwrite: true });

      const prevIds = existingContent
        ? [...existingContent.matchAll(/id:\s*(\d+)/g)].map(m => parseInt(m[1]))
        : [];
      const added = raw.products.filter(p => !prevIds.includes(p.id)).length;
      const action = existingContent != null
        ? `merged — ${added} new product${added !== 1 ? 's' : ''} added`
        : `generated fresh — ${raw.products.length} products`;

      lines.push(
        `\n✅ Test data ${action}`,
        `   Constants: ${constantsPath}`,
      );
    }
  }

  return lines.filter(Boolean).join('\n');
}
