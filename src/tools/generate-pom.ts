import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { chromium } from 'playwright';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';
import { extractJson } from './llm-utils.js';
import type { SiteAuditJson } from './site-audit.js';
import { safeWrite } from '../lib/safe-write.js';
import { TokenBudget } from './budget.js';
import { compilePom, type PomSpec } from '../templates/pom.js';
import { config, SITE_URL, SITE_HOST, buildPomHierarchyDescription } from '../config.js';
import { formatOwnedElements, type OwnedElementsEntry } from './pom-index.js';
import { errorContent } from '../lib/format-error.js';

const ROOT = process.cwd();
const MODEL = config.models.primary;


// ── Audit context ────────────────────────────────────────────────────────────

/**
 * If site-audit-report.json exists, find the page entry matching urlPath
 * (supporting :id / :slug wildcards) and return a compact hint block for
 * inclusion in the LLM prompt.  Falls back gracefully when no audit exists.
 */
async function loadAuditContext(urlPath: string): Promise<string | null> {
  const jsonPath = join(ROOT, 'site-audit-report.json');
  let audit: SiteAuditJson;
  try {
    audit = JSON.parse(await readFile(jsonPath, 'utf-8')) as SiteAuditJson;
  } catch {
    return null;
  }

  for (const page of audit.pages) {
    const regex = new RegExp(
      '^' + page.pattern.replace(/:[^/]+/g, '[^/]+') + '(/.*)?$',
    );
    if (!regex.test(urlPath)) continue;

    const lines: string[] = [];
    if (page.uniqueIds.length)
      lines.push(`Page-specific IDs: ${page.uniqueIds.map(id => `#${id}`).join(', ')}`);
    if (page.uniqueFormInputs.length)
      lines.push(`Form inputs unique to this page: ${page.uniqueFormInputs.join(', ')}`);

    if (lines.length === 0) return null;
    return `## Site audit hints\n${lines.join('\n')}\nUse these as candidates for locators — they are confirmed present on the live page.`;
  }

  return null;
}

// ── Locator validation ───────────────────────────────────────────────────────

interface LocatorResult {
  name: string;
  selector: string;
  count: number;
  status: 'ok' | 'ambiguous' | 'broken';
}

/**
 * Parse all `this.X = page.locator('...')` calls from generated POM content,
 * visit the live page, and count how many elements each selector matches.
 * Only validates `page.locator()` calls — getByRole/getByLabel/getByText are
 * semantic and reliable by design.
 */
async function validateLocators(
  pageUrl: string,
  content: string,
): Promise<LocatorResult[]> {
  // Extract: this.propName = page.locator('selector')  (single or double quotes)
  const pattern = /this\.(\w+)\s*=\s*page\.locator\(['"]([^'"]+)['"]\)/g;
  const locators: Array<{ name: string; selector: string }> = [];
  let m;
  while ((m = pattern.exec(content)) !== null) {
    locators.push({ name: m[1], selector: m[2] });
  }
  if (locators.length === 0) return [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  try {
    const fullUrl = pageUrl.startsWith('http') ? pageUrl : `${SITE_URL}${pageUrl}`;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // let dynamic content settle

    const results: LocatorResult[] = await Promise.all(
      locators.map(async ({ name, selector }) => {
        const count = await page.locator(selector).count();
        return {
          name,
          selector,
          count,
          status: count === 1 ? 'ok' : count === 0 ? 'broken' : 'ambiguous',
        } satisfies LocatorResult;
      }),
    );
    return results;
  } finally {
    await browser.close();
  }
}

function formatValidation(results: LocatorResult[]): string {
  if (results.length === 0) return '';
  const ok = results.filter(r => r.status === 'ok');
  const ambiguous = results.filter(r => r.status === 'ambiguous');
  const broken = results.filter(r => r.status === 'broken');

  const lines: string[] = ['', '## Locator validation'];
  lines.push(`Validated ${results.length} page.locator() selectors against the live page:`);

  if (ok.length) lines.push(`  ✅ ${ok.length} reliable (count = 1)`);
  if (ambiguous.length) {
    lines.push(`  ⚠️  ${ambiguous.length} ambiguous (matches multiple elements — tighten the selector):`);
    ambiguous.forEach(r => lines.push(`       ${r.name}: '${r.selector}' → ${r.count} matches`));
  }
  if (broken.length) {
    lines.push(`  ❌ ${broken.length} broken (no match on live page):`);
    broken.forEach(r => lines.push(`       ${r.name}: '${r.selector}'`));
  }

  if (ambiguous.length === 0 && broken.length === 0) {
    lines.push('All locators confirmed reliable. Safe to run generate_test.');
  } else {
    lines.push('Fix flagged locators before running generate_test to avoid failures.');
  }

  return lines.join('\n');
}

// ── System prompt ────────────────────────────────────────────────────────────

/**
 * Read the source of config.pom's site class and each intermediate class
 * (e.g. SitePage, ProductListPage) so buildSystemPrompt can list the
 * locators/methods they already own. Missing files (a fresh project's
 * not-yet-written classes) are skipped, not errors.
 */
async function loadOwnedElements(): Promise<OwnedElementsEntry[]> {
  const { pom } = config;
  const classes = [
    { name: pom.siteClass, importFrom: `./${pom.siteClass}` },
    ...pom.intermediateClasses.map((ic) => ({ name: ic.name, importFrom: ic.importFrom })),
  ];

  const entries: OwnedElementsEntry[] = [];
  for (const c of classes) {
    const relPath = `pages/${c.importFrom.replace(/^\.\//, '')}.ts`;
    try {
      const content = await readFile(join(ROOT, relPath), 'utf-8');
      entries.push({ name: c.name, file: relPath, content });
    } catch {
      // Class not written yet (e.g. fresh project) — nothing to report.
    }
  }
  return entries;
}

/**
 * Build the system prompt for generate_pom. The POM hierarchy and "already
 * owned" locators/methods are derived from config.pom + the live pages/*.ts
 * files, so a project with a different hierarchy (or none yet) gets correct
 * guidance instead of this project's hardcoded SitePage/ProductListPage shape.
 */
export async function buildSystemPrompt(): Promise<string> {
  const ownedElementsBlock = formatOwnedElements(await loadOwnedElements());

  return `\
You are a Playwright Page Object Model generator for ${SITE_HOST}.

Given a live DOM snapshot of a single page, identify the locators for a
locator-only POM class — no async methods of any kind. You describe each
locator structurally; the .ts file itself is compiled from a fixed template,
so you never write TypeScript syntax directly.

## POM hierarchy — choose the correct parent class

${buildPomHierarchyDescription()}

If the page's URL path matches one of the "paths" patterns listed above for an
intermediate class, extend that class. Otherwise, if the page has the site's
universal nav/footer elements (see the site class above), extend it. Otherwise,
extend the base class.
${ownedElementsBlock}

## What to include
- The primary CTA of the page (the main submit/add-to-cart/place-order button) — always include this
- All interactive elements unique to this page: inputs, buttons, links, selects, textareas
- Key assertion targets: success/error messages, headings, modal containers unique to this page
- Skip purely decorative elements (icons, decorative images, ads, cookie consent sliders)
- Skip #scrollUp, #aswift_0_host, and all #fc-preference-slider-* elements (ad/cookie tech noise)

## Selector types (strict priority order — prefer earlier types when available)
1. "data-qa"      — value is the data-qa attribute value, without brackets or quotes
                    (e.g. "login-email") → compiles to page.locator('[data-qa="login-email"]')
2. "role"         — value is the ARIA role (e.g. "button", "link", "heading");
                    set roleName to the accessible name if there is one
                    → compiles to page.getByRole('button', { name: 'Login' })
3. "label"        — value is the label text → page.getByLabel('...')
4. "placeholder"  — value is the placeholder text → page.getByPlaceholder('...')
5. "text"         — value is the visible text → page.getByText('...')
6. "css"          — value is a raw CSS selector, e.g. "#quantity" → page.locator('...')
                    use this for #id selectors and anything not covered above

## Naming conventions
- camelCase: emailInput, loginButton, errorMessage, cartHeading
- Suffixes: Input, Button, Link, Message, Heading, Modal, Textarea

## Output format
Raw JSON only (no markdown fences, no explanation):
{
  "file": "pages/SomePage.ts",
  "className": "SomePage",
  "parentClass": "${config.pom.siteClass}",
  "locators": [
    { "name": "emailInput", "selectorType": "data-qa", "value": "login-email" },
    { "name": "loginButton", "selectorType": "role", "value": "button", "roleName": "Login" }
  ]
}`;
}


interface PomSpecResponse extends PomSpec {
  file: string;
}

function isPomSpecResponse(value: unknown): value is PomSpecResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.file === 'string' && typeof v.className === 'string'
    && typeof v.parentClass === 'string' && Array.isArray(v.locators);
}

/**
 * Parse the model's structured POM response and compile it to a .ts file via
 * the template in src/templates/pom.ts. Throws if the response is missing
 * required fields or describes an invalid spec (compilePom validates).
 */
function compileResponse(raw: string): { file: string; content: string } {
  const parsed = JSON.parse(extractJson(raw));
  if (!isPomSpecResponse(parsed)) {
    throw new Error('response missing file/className/parentClass/locators fields');
  }
  return { file: parsed.file, content: compilePom(parsed) };
}

async function generateForSnapshot(opts: {
  path: string;
  domText: string;
  nameHint?: string;
  apiKey: string;
  localAvailable: boolean;
  auditContext: string | null;
  systemPrompt: string;
  budget?: TokenBudget;
}): Promise<{ file: string; content: string } | null> {
  const nameHint = opts.nameHint ? `\n\nClass name to use: ${opts.nameHint}` : '';
  const auditHint = opts.auditContext ? `\n\n${opts.auditContext}` : '';
  const userPrompt = `Generate a locator-only POM for the page at ${opts.path}.${nameHint}${auditHint}\n\n${opts.domText}`;

  if (opts.localAvailable) {
    try {
      const raw = await callLocalLlm(opts.systemPrompt, userPrompt);
      return compileResponse(raw);
    } catch (err) {
      process.stderr.write(`[local-llm] POM generation failed (${(err as Error).message}) — falling back to Claude API\n`);
    }
  }

  const MAX_OUTPUT_TOKENS = 4096;

  // Soft pre-flight warning only — same TokenBudget.wouldExceed() check as the
  // fix loop, but POM generation never aborts on it (see investigate-fix.ts).
  if (opts.budget) {
    const estimatedInputTokens = TokenBudget.estimateTokens(opts.systemPrompt + userPrompt);
    if (opts.budget.wouldExceed(estimatedInputTokens, MAX_OUTPUT_TOKENS)) {
      console.warn(
        `\n⚠️  Generating ${opts.path} may push spend past the $${opts.budget.limitUsd.toFixed(2)} budget ` +
        `(currently ${opts.budget.summary}, est. +${estimatedInputTokens} input tokens). ` +
        `Continuing anyway — generation calls warn but don't abort.\n`,
      );
    }
  }

  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');
    return compileResponse(raw);
  } catch { /* */ }

  return null;
}

// Guard: skip files that already have methods (they've been promoted by generate_test
// and should not be touched by this tool). For locator-only files, reject if any
// existing readonly Locator property would be dropped.
async function writeWithLocatorGuard(
  file: string,
  content: string,
): Promise<{ ok: boolean; reason?: string }> {
  const abs = join(ROOT, file);
  try {
    const existing = await readFile(abs, 'utf-8');
    if (/async \w+\s*\(/.test(existing)) {
      return { ok: false, reason: 'file already has methods — use generate_test to extend it' };
    }
    const existingProps = [...existing.matchAll(/readonly (\w+):\s*Locator/g)].map(m => m[1]);
    const missing = existingProps.filter(name => !content.includes(`readonly ${name}:`));
    if (missing.length > 0) {
      return { ok: false, reason: `would remove existing locators: ${missing.join(', ')}` };
    }
  } catch { /* new file — no guard needed */ }
  // The checks above already vet locator preservation for this POM-only file —
  // pass allowOverwrite so safeWrite's generic shrink check doesn't double-guard.
  await safeWrite(abs, content, { allowOverwrite: true });
  return { ok: true };
}

// ── Tool entry point ─────────────────────────────────────────────────────────

export async function generatePomTool(args: {
  urls: string[];
  page_name?: string;
  /** Optional shared cost tracker — see TokenBudget.wouldExceed() in generateForSnapshot. */
  budget?: TokenBudget;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return errorContent('Error: ANTHROPIC_API_KEY is not set.', { category: 'config', tool: 'generate_pom' });
  }

  const localAvailable = await isLocalLlmAvailable();

  let snapshots;
  try {
    snapshots = await inspectPages(args.urls);
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Page inspection failed: ${err.message}` }] };
  }

  const systemPrompt = await buildSystemPrompt();

  // Load audit context and generate POMs in parallel
  const results = await Promise.all(
    snapshots.map(async (snap) => {
      const auditContext = await loadAuditContext(snap.path);
      return generateForSnapshot({
        path: snap.path,
        domText: formatSnapshots([snap]),
        nameHint: args.urls.length === 1 ? args.page_name : undefined,
        apiKey,
        localAvailable,
        auditContext,
        systemPrompt,
        budget: args.budget,
      });
    }),
  );

  const written: string[] = [];
  const skipped: string[] = [];
  const writtenFiles: Array<{ urlPath: string; filePath: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) { skipped.push('(generation failed)'); continue; }
    const { ok, reason } = await writeWithLocatorGuard(result.file, result.content);
    if (ok) {
      written.push(result.file);
      writtenFiles.push({ urlPath: snapshots[i].path, filePath: result.file });
    } else {
      skipped.push(`${result.file} — ${reason}`);
    }
  }

  const model = localAvailable ? LOCAL_MODEL : 'Claude API';
  const lines: string[] = written.length > 0
    ? [`✅ Generated locator-only POM${written.length > 1 ? 's' : ''} via ${model}:`, ...written.map(f => `  - ${f}`)]
    : ['⚠️  No files written.'];

  if (skipped.length > 0) {
    lines.push('', '⚠️  Skipped:', ...skipped.map(s => `  - ${s}`));
  }

  // Validate locators — read from disk so the content exactly matches what was written
  for (const { urlPath, filePath } of writtenFiles) {
    try {
      const content = await readFile(join(ROOT, filePath), 'utf-8');
      const validation = await validateLocators(urlPath, content);
      const report = formatValidation(validation);
      if (report) lines.push(report);
    } catch (err: any) {
      lines.push(`\n⚠️  Locator validation skipped for ${filePath}: ${err.message}`);
    }
  }

  lines.push(
    '',
    'These files contain only locators — no methods.',
    'Run `generate_test` next; it will add methods using the correct locators already on disk.',
  );

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
