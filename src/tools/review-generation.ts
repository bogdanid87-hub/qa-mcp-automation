import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getSystemBlocks } from '../prompts/system.js';
import { getPomIndex } from './list-resources.js';
import { extractPomMethods, extractPomLocators, type PomIndexEntry } from './pom-index.js';
import { extractJson } from './llm-utils.js';
import { TokenBudget } from './budget.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

export interface ReviewIssue {
  severity: 'warning' | 'info';
  category: 'locator-collision' | 'forwarding-alias' | 'fixture-usage' | string;
  file: string;
  message: string;
}

export interface ReviewResult {
  issues: ReviewIssue[];
}

// ── Deterministic check: locator collisions ────────────────────────────────
//
// CORE_RULES requires class-based locators to be scoped by element type or a
// unique ancestor — a bare/compound class selector (e.g. `.alert-success.alert`)
// can collide with the same class combination used elsewhere on the page
// (Rules 004/024/025). Rather than re-stating that prose, count elements whose
// `class` attribute contains every token in the selector — anything that
// resolves to >1 element is a structural collision, full stop. This selector
// space (bare/compound class names only, no element type/id/attribute/descendant
// combinators) is simple enough that a regex over the captured HTML is exact,
// without needing a browser.

const BARE_CLASS_SELECTOR_RE = /^\.[\w-]+(?:\.[\w-]+)*$/;
const CLASS_ATTR_RE = /\bclass\s*=\s*(["'])((?:\\.|(?!\1).)*)\1/gi;

/** Count elements in `html` whose `class` attribute contains every class in `classes`. */
function countElementsWithClasses(html: string, classes: string[]): number {
  let count = 0;
  for (const m of html.matchAll(CLASS_ATTR_RE)) {
    const elementClasses = new Set(m[2].split(/\s+/).filter(Boolean));
    if (classes.every((c) => elementClasses.has(c))) count++;
  }
  return count;
}

/**
 * Flags POM locators defined with a bare/compound class selector (e.g.
 * `.alert-success.alert`) that resolve to more than one element on any of the
 * given pages. `pages` is the raw HTML captured by inspectPages() during
 * generation — when empty, this check is skipped entirely (no DOM to test against).
 */
export function checkLocatorCollisions(
  pomFiles: { path: string; content: string }[],
  pages: { url: string; html: string }[],
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (pages.length === 0) return issues;

  const candidates = pomFiles.flatMap((f) =>
    extractPomLocators(f.content)
      .filter((l) => BARE_CLASS_SELECTOR_RE.test(l.selector))
      .map((l) => ({ file: f.path, ...l })),
  );

  for (const candidate of candidates) {
    const classes = candidate.selector.split('.').filter(Boolean);
    for (const p of pages) {
      const count = countElementsWithClasses(p.html, classes);
      if (count > 1) {
        issues.push({
          severity: 'warning',
          category: 'locator-collision',
          file: candidate.file,
          message: `Locator '${candidate.selector}' (this.${candidate.name}) matches ${count} elements on ${p.url} — scope it to a unique ancestor container (CORE_RULES Locator rules).`,
        });
        break;
      }
    }
  }
  return issues;
}

// ── Deterministic check: forwarding-alias / near-duplicate methods ─────────
//
// Splits a method name into lowercase camelCase tokens, e.g. "getRowProductName"
// -> ["get", "row", "product", "name"].
function camelTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Jaccard similarity (intersection over union) between two token sets. */
export function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function paramCount(params: string): number {
  return params.trim() === '' ? 0 : params.split(',').length;
}

// Two methods with the same param count and (when both specify one) the same
// return type, whose name tokens overlap at least this much, are flagged as a
// likely forwarding alias rather than a genuinely different method.
const SIMILARITY_THRESHOLD = 0.6;

/**
 * Flags methods in newly-written/edited POM files whose name is a near-duplicate
 * (by token overlap) of a method that already exists on a DIFFERENT POM class with
 * the same param count and a compatible return type — the forwarding-alias pattern
 * CORE_RULES' POM Method Index section forbids (e.g. CartPage.getProductName(i)
 * vs ViewCartPage.getRowProductName(i)).
 */
export function checkForwardingAliases(
  pomFiles: { path: string; content: string }[],
  index: PomIndexEntry[],
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  for (const f of pomFiles) {
    for (const method of extractPomMethods(f.content)) {
      const methodParamCount = paramCount(method.params);
      const methodTokens = camelTokens(method.name);

      for (const entry of index) {
        if (entry.file === f.path) continue;

        for (const existing of entry.methods) {
          if (existing.name === method.name) continue;
          if (paramCount(existing.params) !== methodParamCount) continue;
          if (existing.returnType && method.returnType && existing.returnType !== method.returnType) continue;

          const similarity = jaccard(methodTokens, camelTokens(existing.name));
          if (similarity >= SIMILARITY_THRESHOLD) {
            issues.push({
              severity: 'warning',
              category: 'forwarding-alias',
              file: f.path,
              message: `${method.name}(${method.params}) looks like a near-duplicate of ${entry.className}.${existing.name}(${existing.params}) (${entry.file}) — reuse the existing method instead of adding a forwarding alias (CORE_RULES POM Method Index).`,
            });
          }
        }
      }
    }
  }

  return issues;
}

// ── Deterministic check: fixture usage ──────────────────────────────────────

const NEW_POM_RE = /new\s+(\w+Page)\s*\(\s*page\s*\)/g;

/** Flags `new SomePage(page)` in spec files — POMs must be obtained via a fixture. */
export function checkFixtureUsage(specFiles: { path: string; content: string }[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const f of specFiles) {
    for (const match of f.content.matchAll(NEW_POM_RE)) {
      issues.push({
        severity: 'warning',
        category: 'fixture-usage',
        file: f.path,
        message: `Found \`new ${match[1]}(page)\` — specs must obtain POMs via a fixture, not by direct instantiation (CORE_RULES Fixtures section).`,
      });
    }
  }
  return issues;
}

// ── LLM call: remaining CORE_RULES checks ──────────────────────────────────

interface ReviewLlmResponse {
  issues?: { category?: string; file: string; message: string; severity?: 'warning' | 'info' }[];
}

const REMAINING_CHECKS_PROMPT = `\
Review the newly written/edited files below against CORE_RULES, focusing ONLY on these \
two checks (everything else is either out of scope for this review or already covered by \
deterministic checks):

1. **Shared value helpers (utils/)** — inline currency/date/percentage parsing or \
   formatting that duplicates (or should use) a helper in utils/ (e.g. parsing "Rs. 500" \
   with an inline regex instead of utils/price.ts's parsePrice/formatPrice).
2. **No hardcoded application data** — assertions on specific product names, prices, \
   counts, or other content that should instead be captured at runtime and compared \
   structurally.

Respond with raw JSON only (no markdown fences):
{
  "issues": [
    { "category": "currency-parsing" | "hardcoded-data", "file": "relative/path", "message": "what's wrong and the suggested fix" }
  ]
}
If neither check finds anything, respond with { "issues": [] }.
`;

/**
 * One LLM call covering the CORE_RULES checks the deterministic checks above can't —
 * fed the deterministic findings as already-confirmed issues so it doesn't repeat them.
 * Returns [] (never throws) if ANTHROPIC_API_KEY is unset, the budget is already
 * exhausted, the pre-flight estimate would exceed it, or the call/parse fails —
 * this pass is advisory and must never block generateTestTool's response.
 */
async function checkRemainingRules(
  files: { path: string; content: string }[],
  deterministicIssues: ReviewIssue[],
  budget?: TokenBudget,
): Promise<ReviewIssue[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey || budget?.exceeded) return [];

  const filesBlock = files.map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n');
  const confirmedBlock = deterministicIssues.length > 0
    ? `\n\nThe following issues were already found by deterministic checks — do not repeat them:\n${deterministicIssues.map((i) => `- [${i.category}] ${i.file}: ${i.message}`).join('\n')}\n`
    : '';

  const systemBlocks = await getSystemBlocks();
  const userBlocks: Anthropic.MessageParam['content'] = [
    { type: 'text', text: `## Newly written/edited files\n\n${filesBlock}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `${confirmedBlock}\n${REMAINING_CHECKS_PROMPT}` },
  ];

  const MAX_OUTPUT_TOKENS = 1024;
  if (budget) {
    const estimatedInputTokens = TokenBudget.estimateTokens(
      systemBlocks.map((b) => b.text).join('') + filesBlock + confirmedBlock + REMAINING_CHECKS_PROMPT,
    );
    if (budget.wouldExceed(estimatedInputTokens, MAX_OUTPUT_TOKENS)) {
      process.stderr.write(`[review-generation] skipping LLM review pass — would push spend past the $${budget.limitUsd.toFixed(2)} budget\n`);
      return [];
    }
  }

  const client = new Anthropic({ apiKey });
  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      messages: [{ role: 'user', content: userBlocks }],
    });
    budget?.add(
      message.usage.input_tokens,
      message.usage.output_tokens,
      message.usage.cache_creation_input_tokens ?? 0,
      message.usage.cache_read_input_tokens ?? 0,
    );
    raw = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch {
    return [];
  }

  try {
    const parsed: ReviewLlmResponse = JSON.parse(extractJson(raw));
    return (parsed.issues ?? []).map((i) => ({
      severity: i.severity ?? 'info',
      category: i.category ?? 'other',
      file: i.file,
      message: i.message,
    }));
  } catch {
    return [];
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Hybrid pre-write reviewer pass: runs free, deterministic structural checks first
 * (locator collisions, forwarding-alias methods, fixture usage), then one LLM call
 * for the remaining semantic CORE_RULES checks, fed the deterministic findings as
 * confirmed issues. Report-only — callers append the result to their output, never
 * retry or block on it.
 *
 * `written` is generateTestTool's list of file paths actually written to disk
 * (a `fixtures/index.ts (updated)` suffix, if present, is stripped before reading).
 * `pages` is the raw HTML captured by inspectPages() during generation, used by the
 * locator-collision check — pass [] when no page_paths were inspected.
 */
export async function reviewGeneratedFiles(
  written: string[],
  opts: { pages?: { url: string; html: string }[]; budget?: TokenBudget } = {},
): Promise<ReviewResult> {
  const files = (await Promise.all(
    written.map(async (p) => {
      const path = p.replace(/ \(updated\)$/, '');
      try {
        return { path, content: await readFile(join(ROOT, path), 'utf-8') };
      } catch {
        return null;
      }
    }),
  )).filter((f): f is { path: string; content: string } => f !== null);

  const pomFiles = files.filter((f) => f.path.startsWith('pages/'));
  const specFiles = files.filter((f) => f.path.startsWith('tests/') && f.path.endsWith('.spec.ts'));

  const issues: ReviewIssue[] = [];

  if (pomFiles.length > 0 && (opts.pages?.length ?? 0) > 0) {
    issues.push(...checkLocatorCollisions(pomFiles, opts.pages!));
  }

  if (pomFiles.length > 0) {
    issues.push(...checkForwardingAliases(pomFiles, await getPomIndex()));
  }

  if (specFiles.length > 0) {
    issues.push(...checkFixtureUsage(specFiles));
  }

  if (files.length > 0) {
    issues.push(...await checkRemainingRules(files, issues, opts.budget));
  }

  return { issues };
}
