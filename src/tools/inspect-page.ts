import { chromium, type Page, type BrowserContext } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';
import { SITE_URL } from '../config.js';

const ROOT = process.cwd();
const BASE_URL = SITE_URL;
const STORAGE_STATE = join(ROOT, 'test-data/.auth/guest.json');

interface ElementInfo {
  selector: string;        // best locator to use
  tag: string;
  role?: string;
  dataQa?: string;
  id?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  text?: string;
  ariaLabel?: string;
  classes?: string;
  note?: string;           // e.g. "hidden by default", "success message"
}

export interface PageSnapshot {
  path: string;
  url: string;
  title: string;
  headings: string[];
  elements: ElementInfo[];
  forms: { id?: string; action?: string; method?: string; enctype?: string }[];
  /** Raw page.content() HTML — not included in formatSnapshots(), used by review-generation's locator-collision check. */
  html?: string;
}

const GOTO_TIMEOUT_MS = 45_000;

/** Navigate with one retry — slow/throttled sites sometimes exceed the first timeout. */
async function gotoWithRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS });
      return;
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
}

/** Navigate to each path and extract DOM element info for POM generation. */
export async function inspectPages(paths: string[]): Promise<PageSnapshot[]> {
  const browser = await chromium.launch({ headless: true });
  const snapshots: PageSnapshot[] = [];

  try {
    for (const path of paths) {
      const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
      let context: BrowserContext | undefined;
      try {
      // Reuse the saved guest storage state when present (it carries cookies/CF
      // clearance for the reference site). On a fresh project the file won't exist
      // yet — start from a clean context rather than throwing ENOENT.
      context = await browser.newContext(
        existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {},
      );

      // Block ads so the page settles faster
      await context.route('**/*', (route) => {
        const adFragments = ['googlesyndication', 'doubleclick', 'googleads', 'adsbygoogle', 'pagead'];
        if (adFragments.some((f) => route.request().url().includes(f))) {
          route.abort();
        } else {
          route.continue();
        }
      });

      const page = await context.newPage();
      // 'domcontentloaded', not 'load' — ad/analytics-heavy sites often never fire
      // 'load' within the timeout. Mirrors the navigation convention the engine
      // teaches in generated tests.
      await gotoWithRetry(page, url);
      await page.waitForTimeout(1500); // let client-rendered / AJAX content settle

      // Pass the evaluate body as a string to avoid esbuild injecting __name helpers
      // that aren't available in the browser context.
      const snapshot = await page.evaluate(`
        (() => {
          const path = ${JSON.stringify(path)};
          const url = ${JSON.stringify(url)};
          const title = document.title;

          const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(
            h => h.tagName + ': "' + h.textContent.trim() + '"'
          );

          const forms = Array.from(document.forms).map(f => ({
            id: f.id || undefined,
            action: f.action,
            method: f.method,
            enctype: f.enctype,
          }));

          const seen = new Set();
          const elements = [];

          function push(el) {
            const dqa = el.getAttribute('data-qa');
            const id = el.getAttribute('id');
            const selector = dqa ? '[data-qa="' + dqa + '"]' : id ? '#' + id : '';
            if (!selector || seen.has(selector)) return;
            seen.add(selector);
            const tag = el.tagName.toLowerCase();
            const isHidden = el.style.display === 'none' || el.offsetWidth === 0;
            const entry = {
              selector,
              tag,
              dataQa: dqa || undefined,
              id: id || undefined,
              type: el.getAttribute('type') || undefined,
              name: el.getAttribute('name') || undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              text: (tag === 'input' || tag === 'textarea') ? undefined : (el.textContent.trim().substring(0, 60) || undefined),
              classes: el.getAttribute('class') || undefined,
              note: isHidden ? 'hidden by default' : undefined,
            };
            elements.push(entry);
          }

          document.querySelectorAll('[data-qa]').forEach(push);
          document.querySelectorAll('input[id],textarea[id],select[id],button[id],a[id]').forEach(push);

          document.querySelectorAll('input[type="file"]').forEach(el => {
            const nm = el.getAttribute('name');
            if (!nm) return;
            const sel = '[name="' + nm + '"]';
            if (seen.has(sel)) return;
            seen.add(sel);
            elements.push({ selector: sel, tag: 'input', type: 'file', name: nm });
          });

          document.querySelectorAll('[class*="alert"],[class*="status"],[class*="success"],[class*="error"]').forEach(el => {
            const cls = el.getAttribute('class') || '';
            const sel = '.' + cls.trim().split(/\\s+/).join('.');
            if (seen.has(sel) || !cls) return;
            seen.add(sel);
            const isHidden = el.style.display === 'none' || el.offsetWidth === 0;
            elements.push({ selector: sel, tag: el.tagName.toLowerCase(), text: el.textContent.trim().substring(0, 60) || undefined, note: isHidden ? 'hidden by default' : undefined });
          });

          document.querySelectorAll('nav a[href], .navbar a[href], header a[href]').forEach(el => {
            const href = el.getAttribute('href') || '';
            const label = el.textContent.trim();
            if (!href || !label) return;
            const sel = 'a[href="' + href + '"]';
            if (seen.has(sel)) return;
            seen.add(sel);
            elements.push({ selector: sel, tag: 'a', text: label });
          });

          return { path, url, title, headings, elements, forms };
        })()
      `) as PageSnapshot;

      snapshot.html = await page.content();
      snapshots.push(snapshot);
      } catch (err) {
        // Per-page isolation: one slow/failed page is skipped, not fatal —
        // the other pages still produce snapshots.
        process.stderr.write(`[inspect-page] skipping ${url} — ${(err as Error)?.message ?? String(err)}\n`);
      } finally {
        await context?.close();
      }
    }
  } finally {
    await browser.close();
  }

  return snapshots;
}

// If total formatted DOM exceeds this, condense to high-priority elements only.
const DOM_CHAR_THRESHOLD = 12_000;

function formatSingleSnapshot(s: PageSnapshot): string {
  const lines: string[] = [
    `## DOM snapshot: ${s.path} (${s.title})`,
    '',
    '### Headings',
    ...s.headings.map((h) => `  - ${h}`),
    '',
    '### Forms',
    ...s.forms.map(
      (f) =>
        `  - id="${f.id ?? '—'}" action="${f.action}" method="${f.method}" enctype="${f.enctype}"`,
    ),
    '',
    '### Elements (use these for locators — listed in priority order)',
    ...s.elements.map((el) => {
      const parts: string[] = [`  - ${el.selector} [${el.tag}]`];
      if (el.type) parts.push(`type="${el.type}"`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.text) parts.push(`text="${el.text}"`);
      if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
      if (el.note) parts.push(`⚠ ${el.note}`);
      return parts.join(' | ');
    }),
  ];
  return lines.join('\n');
}

/** Format snapshots as a markdown block for Claude's context.
 *  Automatically condenses to high-priority elements when output exceeds DOM_CHAR_THRESHOLD. */
export function formatSnapshots(snapshots: PageSnapshot[]): string {
  const full = snapshots.map(formatSingleSnapshot).join('\n\n');
  if (full.length <= DOM_CHAR_THRESHOLD) return full;

  // Over threshold: keep data-qa elements + form controls + first 8 nav links per page
  const condensed = snapshots.map((s) => {
    const priority = s.elements.filter(
      (el) => el.dataQa || ['input', 'button', 'select', 'textarea'].includes(el.tag),
    );
    const nav = s.elements.filter((el) => el.tag === 'a').slice(0, 8);
    return formatSingleSnapshot({ ...s, elements: [...priority, ...nav] });
  }).join('\n\n');

  return condensed + '\n\n_(DOM condensed to key elements — use inspect_page for full detail)_';
}

/** MCP tool handler — inspect one or more page paths. */
export async function inspectPageTool(args: {
  paths: string[];
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  try {
    const snapshots = await inspectPages(args.paths);
    const text = formatSnapshots(snapshots);
    return { content: [{ type: 'text', text }] };
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Inspection failed: ${err.message}` }],
    };
  }
}
