import { chromium } from '@playwright/test';
import { writeFile } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd();

export interface SiteAuditArgs {
  url: string;
  output?: string;
  maxPageTypes?: number;
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
  const base = normaliseBase(args.url);
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

  const allHrefs: string[] = await crawlPage.evaluate((base: string) => {
    return [...new Set(
      [...document.querySelectorAll('a[href]')]
        .map(a => (a as HTMLAnchorElement).href)
        .filter(h => h && h.startsWith(base) && !h.includes('#') && !h.match(/\.(pdf|zip|png|jpg|gif|css|js)$/i))
    )];
  }, base);

  await crawlPage.close();
  process.stdout.write(`  Found ${allHrefs.length} internal URLs\n`);

  // ── Step 2: Deduplicate into page-type patterns ────────────────────────────
  const patternMap = new Map<string, string>(); // pattern → first representative URL
  patternMap.set('/', args.url);                 // always include root
  for (const href of allHrefs) {
    const pattern = toPattern(href, base);
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

  return lines.join('\n');
}

export async function siteAuditTool(args: SiteAuditArgs): Promise<string> {
  const outputPath = args.output ?? join(ROOT, 'site-audit-report.md');

  process.stdout.write(`\n🔍 Site audit: ${args.url}\n\n`);
  const result = await runSiteAudit(args);

  const report = buildReport(result);
  await writeFile(outputPath, report, 'utf-8');

  // Console summary
  const total = result.pageTypes.length;
  const universalIds = [...result.idPresence.entries()]
    .filter(([, p]) => p.length === total).map(([id]) => id);
  const sharedGroups = [...new Set(
    [...result.idPresence.entries()]
      .filter(([, p]) => p.length >= 2 && p.length < total)
      .map(([, p]) => p.sort().join(','))
  )].length;

  return [
    `\n✅ Audit complete — ${total} page types analysed`,
    `   Universal elements (#${universalIds.slice(0, 4).join(', #')}${universalIds.length > 4 ? '...' : ''}) → SitePage candidate`,
    sharedGroups > 0 ? `   ${sharedGroups} partial-overlap group(s) → intermediate class candidate(s)` : '',
    `\n   Full report: ${outputPath}`,
  ].filter(Boolean).join('\n');
}
