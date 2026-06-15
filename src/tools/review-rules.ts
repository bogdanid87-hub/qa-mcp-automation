import { readFile, writeFile } from 'fs/promises';
import {
  FRAMEWORK_RULES_PATH,
  FRAMEWORK_RULES_TEMPLATE,
  LEARNED_RULES_PATH,
  parseRuleEntries,
  promoteRule,
  type RuleEntry,
} from '../prompts/system.js';
import { getPomIndex } from './list-resources.js';
import { jaccard } from './review-generation.js';
import type { PomIndexEntry } from './pom-index.js';

const LEARNED_RULES_TEMPLATE = `# Learned Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n`;

export interface LabeledRuleEntry extends RuleEntry {
  source: 'learned' | 'framework';
  label: string; // "Rule 015" / "FW-Rule 002"
}

export interface StaleRule {
  num: string;
  title: string;
  reason: string;
}

export interface DuplicateRulePair {
  a: { label: string; title: string };
  b: { label: string; title: string };
  similarity: number;
}

export interface ReviewRulesResult {
  staleRules: StaleRule[];
  duplicates: DuplicateRulePair[];
}

// Only matches "<SomePage>.method(" — restricting to the project's "*Page" POM
// naming convention (qa-conventions) avoids false positives on JS/TS builtins
// (JSON.parse, Array.from, Promise.all, ...), none of which end in "Page".
const PAGE_METHOD_RE = /\b(\w+Page)\.(\w+)\(/g;

/**
 * Cross-reference <SomePage>.method() references in learned-rules.md entries
 * against the current pages/*.ts POM index. Flags a rule as stale if the
 * referenced class no longer exists, or exists but no longer has that method.
 *
 * Known limitation: only catches *Page.method() references — does not detect
 * stale CSS-selector references (e.g. a rule mentioning a selector that no
 * longer appears anywhere in pages/*.ts). Same "best-effort" scope as
 * extractPomLocators's documented coverage limits.
 */
export function findStaleRules(entries: RuleEntry[], pomIndex: PomIndexEntry[]): StaleRule[] {
  const classByName = new Map(pomIndex.map((e) => [e.className, e]));
  const stale: StaleRule[] = [];

  for (const entry of entries) {
    for (const m of entry.raw.matchAll(PAGE_METHOD_RE)) {
      const [, className, methodName] = m;
      const cls = classByName.get(className);
      if (!cls) {
        stale.push({
          num: entry.num,
          title: entry.title,
          reason: `references ${className}.${methodName}(), but ${className} no longer exists in pages/*.ts`,
        });
      } else if (!cls.methods.some((meth) => meth.name === methodName)) {
        stale.push({
          num: entry.num,
          title: entry.title,
          reason: `references ${className}.${methodName}(), but ${className} has no method named ${methodName}`,
        });
      }
    }
  }
  return stale;
}

// Lowercase, split on non-alphanumeric, drop short words (<4 chars) — removes
// most grammatical glue ("the", "and", "a", "to", "of") while keeping content
// words. Deliberately simpler than camelTokens (review-generation.ts), which
// splits camelCase identifiers, not prose.
export function proseTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

// Calibrated against the real Rule 004/024 pair (both "shared CSS class"
// rules, but textually distinct — similarity ≈0.07 with this tokenizer, well
// below threshold: a true negative) and a synthetic near-identical pair in
// unit tests (a true positive, well above threshold).
export const DUPLICATE_THRESHOLD = 0.4;

/** All pairwise near-duplicate rule-text matches across learned + framework entries. */
export function findNearDuplicates(entries: LabeledRuleEntry[]): DuplicateRulePair[] {
  const pairs: DuplicateRulePair[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const tokensA = proseTokens(`${entries[i].problemClass} ${entries[i].rule}`);
      const tokensB = proseTokens(`${entries[j].problemClass} ${entries[j].rule}`);
      const similarity = jaccard(tokensA, tokensB);
      if (similarity >= DUPLICATE_THRESHOLD) {
        pairs.push({
          a: { label: entries[i].label, title: entries[i].title },
          b: { label: entries[j].label, title: entries[j].title },
          similarity,
        });
      }
    }
  }
  return pairs;
}

async function readRulesFile(path: string, fallback: string): Promise<string> {
  return readFile(path, 'utf-8').catch(() => fallback);
}

/** Read-only hygiene report: stale rules + near-duplicate pairs. */
export async function reviewRules(): Promise<ReviewRulesResult> {
  const [learnedContent, frameworkContent, pomIndex] = await Promise.all([
    readRulesFile(LEARNED_RULES_PATH, LEARNED_RULES_TEMPLATE),
    readRulesFile(FRAMEWORK_RULES_PATH, FRAMEWORK_RULES_TEMPLATE),
    getPomIndex(),
  ]);

  const learnedEntries: LabeledRuleEntry[] = parseRuleEntries(learnedContent, 'Rule').map((e) => ({
    ...e,
    source: 'learned' as const,
    label: `Rule ${e.num}`,
  }));
  const frameworkEntries: LabeledRuleEntry[] = parseRuleEntries(frameworkContent, 'FW-Rule').map((e) => ({
    ...e,
    source: 'framework' as const,
    label: `FW-Rule ${e.num}`,
  }));

  return {
    staleRules: findStaleRules(learnedEntries, pomIndex),
    duplicates: findNearDuplicates([...learnedEntries, ...frameworkEntries]),
  };
}

/** Move `## Rule <num>` from learned-rules.md into framework-rules.md as the next `## FW-Rule`. */
export async function promoteRuleToFramework(
  num: string,
): Promise<{ promoted: RuleEntry | null; remainingCount: number }> {
  const [learnedContent, frameworkContent] = await Promise.all([
    readRulesFile(LEARNED_RULES_PATH, LEARNED_RULES_TEMPLATE),
    readRulesFile(FRAMEWORK_RULES_PATH, FRAMEWORK_RULES_TEMPLATE),
  ]);

  const {
    learnedContent: newLearned,
    frameworkContent: newFramework,
    promoted,
  } = promoteRule(learnedContent, frameworkContent, num);

  if (!promoted) {
    return { promoted: null, remainingCount: parseRuleEntries(learnedContent, 'Rule').length };
  }

  await Promise.all([
    writeFile(LEARNED_RULES_PATH, newLearned, 'utf-8'),
    writeFile(FRAMEWORK_RULES_PATH, newFramework, 'utf-8'),
  ]);

  return { promoted, remainingCount: parseRuleEntries(newLearned, 'Rule').length };
}

function formatReport({ staleRules, duplicates }: ReviewRulesResult): string {
  const lines: string[] = ['# Rule hygiene report', ''];

  if (staleRules.length === 0 && duplicates.length === 0) {
    lines.push('No stale rules and no near-duplicate pairs found — learned-rules.md and framework-rules.md look clean.');
  } else {
    if (staleRules.length > 0) {
      lines.push(`## Stale rules (${staleRules.length})`, '');
      for (const r of staleRules) lines.push(`- Rule ${r.num} — ${r.title}: ${r.reason}`);
      lines.push('');
    }
    if (duplicates.length > 0) {
      lines.push(`## Near-duplicate pairs (${duplicates.length})`, '');
      for (const p of duplicates) {
        lines.push(`- ${p.a.label} vs ${p.b.label} (similarity: ${p.similarity.toFixed(2)})`);
        lines.push(`  - ${p.a.label}: ${p.a.title}`);
        lines.push(`  - ${p.b.label}: ${p.b.title}`);
      }
      lines.push('');
    }
  }

  lines.push(
    'Which rules (if any) are worth promoting is a human judgment call — this',
    "tool doesn't suggest promotion candidates, only hygiene issues.",
    '',
    'To promote a rule from learned-rules.md to framework-rules.md:',
    '  npm run review_rules -- --promote <NNN>',
  );
  return lines.join('\n');
}

export async function reviewRulesTool(
  args: { promote?: string } = {},
): Promise<{ content: { type: 'text'; text: string }[] }> {
  if (args.promote) {
    const { promoted, remainingCount } = await promoteRuleToFramework(args.promote);
    const text = promoted
      ? `Promoted Rule ${promoted.num} ("${promoted.title}") to framework-rules.md.\n` +
        `learned-rules.md renumbered — ${remainingCount} rule(s) remain (001-${String(remainingCount).padStart(3, '0')}).`
      : `No Rule ${args.promote.padStart(3, '0')} found in learned-rules.md — nothing to promote.\n` +
        `Run review_rules (no args) to see current rule numbers.`;
    return { content: [{ type: 'text', text }] };
  }

  return { content: [{ type: 'text', text: formatReport(await reviewRules()) }] };
}
