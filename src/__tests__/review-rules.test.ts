import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  findStaleRules,
  proseTokens,
  findNearDuplicates,
  reviewRules,
  DUPLICATE_THRESHOLD,
  type LabeledRuleEntry,
} from '../tools/review-rules';
import { parseRuleEntries, type RuleEntry } from '../prompts/system';
import { jaccard } from '../tools/review-generation';
import type { PomIndexEntry } from '../tools/pom-index';

function makeEntry(raw: string, overrides: Partial<RuleEntry> = {}): RuleEntry {
  return { num: '001', title: 'Test rule', problemClass: '', rule: '', raw, ...overrides };
}

function makeLabeled(problemClass: string, rule: string, label = 'Rule 001'): LabeledRuleEntry {
  return { num: '001', title: 'Test rule', problemClass, rule, raw: '', source: 'learned', label };
}

describe('findStaleRules', () => {
  const pomIndex: PomIndexEntry[] = [
    {
      file: 'pages/BasePage.ts',
      className: 'BasePage',
      methods: [{ name: 'navigate', params: 'path: string', returnType: 'Promise<void>' }],
    },
  ];

  it('returns [] when the referenced class and method both exist', () => {
    const entries = [makeEntry('Some text referencing BasePage.navigate(...) here.')];

    expect(findStaleRules(entries, pomIndex)).toEqual([]);
  });

  it('flags a rule referencing a class that no longer exists', () => {
    const entries = [makeEntry('Some text referencing FooPage.bar(...) here.', { num: '002', title: 'Foo rule' })];

    const result = findStaleRules(entries, pomIndex);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ num: '002', title: 'Foo rule' });
    expect(result[0].reason).toContain('FooPage no longer exists in pages/*.ts');
  });

  it('flags a rule referencing a method that no longer exists on an existing class', () => {
    const entries = [
      makeEntry('Some text referencing BasePage.removedMethod(...) here.', { num: '003', title: 'Removed method rule' }),
    ];

    const result = findStaleRules(entries, pomIndex);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ num: '003', title: 'Removed method rule' });
    expect(result[0].reason).toContain('BasePage has no method named removedMethod');
  });

  it('returns [] for a rule with no *Page.method(...) references', () => {
    const entries = [makeEntry('This rule never mentions any page object method.')];

    expect(findStaleRules(entries, pomIndex)).toEqual([]);
  });

  it('does not match JS/TS builtins like JSON.parse or Promise.all', () => {
    const entries = [makeEntry('Wrap the call: await Promise.all([JSON.parse(a), JSON.parse(b)]).')];

    expect(findStaleRules(entries, pomIndex)).toEqual([]);
  });
});

describe('proseTokens', () => {
  it('lowercases and drops words shorter than 4 characters', () => {
    expect(proseTokens('The Quick Brown Fox')).toEqual(['quick', 'brown']);
  });

  it('splits on punctuation and whitespace', () => {
    expect(proseTokens('locator.count() resolves')).toEqual(['locator', 'count', 'resolves']);
  });
});

describe('findNearDuplicates', () => {
  it('flags two near-identical rule texts as a duplicate pair', () => {
    const a = makeLabeled(
      'Clicking the submit button before the form validation completes does nothing.',
      'Wait for the form validation to complete before clicking submit.',
      'Rule 001',
    );
    const b = makeLabeled(
      'Clicking the submit button before form validation finishes does nothing at all.',
      'Wait for form validation to finish before clicking the submit button.',
      'Rule 002',
    );

    const pairs = findNearDuplicates([a, b]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(pairs[0].a.label).toBe('Rule 001');
    expect(pairs[0].b.label).toBe('Rule 002');
  });

  it('returns [] for two unrelated rule texts', () => {
    const a = makeLabeled(
      'API responses always return HTTP 200.',
      'Assert body.responseCode instead of HTTP status.',
      'Rule 003',
    );
    const b = makeLabeled(
      'Carousel slides are hidden from visibility checks.',
      'Use toBeAttached on slide images instead.',
      'Rule 004',
    );

    expect(findNearDuplicates([a, b])).toEqual([]);
  });

  it('finds the real Rule 004 vs Rule 024 pair below the duplicate threshold', async () => {
    const content = await readFile(join(process.cwd(), 'learned-rules.md'), 'utf-8');
    const entries = parseRuleEntries(content);

    const rule004 = entries.find((e) => e.num === '004')!;
    const rule024 = entries.find((e) => e.num === '024')!;

    const tokensA = proseTokens(`${rule004.problemClass} ${rule004.rule}`);
    const tokensB = proseTokens(`${rule024.problemClass} ${rule024.rule}`);

    expect(jaccard(tokensA, tokensB)).toBeLessThan(DUPLICATE_THRESHOLD);
  });
});

describe('reviewRules', () => {
  it("resolves against this project's real learned-rules.md and framework-rules.md without throwing", async () => {
    const result = await reviewRules();

    expect(Array.isArray(result.staleRules)).toBe(true);
    expect(Array.isArray(result.duplicates)).toBe(true);
  });

  it('is deterministic across repeated calls', async () => {
    const [first, second] = await Promise.all([reviewRules(), reviewRules()]);

    expect(second).toEqual(first);
  });
});
