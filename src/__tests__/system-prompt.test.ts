import { describe, it, expect } from 'vitest';
import {
  appendRuleToContent,
  extractRulesSection,
  getSystemPrompt,
  getSystemBlocks,
  parseRuleEntries,
  removeRuleFromContent,
  promoteRule,
} from '../prompts/system';

describe('extractRulesSection', () => {
  it('extracts the content between the rules-start/rules-end markers', () => {
    const content = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — foo\ntext\n<!-- rules-end -->\n`;
    expect(extractRulesSection(content)).toBe('## Rule 001 — foo\ntext');
  });

  it('trims surrounding whitespace inside the markers', () => {
    const content = `<!-- rules-start -->\n\n  ## Rule 001 — foo  \n\n<!-- rules-end -->`;
    expect(extractRulesSection(content)).toBe('## Rule 001 — foo');
  });

  it('falls back to the trimmed full content when markers are absent', () => {
    const content = '  some raw content without markers  ';
    expect(extractRulesSection(content)).toBe('some raw content without markers');
  });
});

describe('appendRuleToContent', () => {
  const EMPTY = '# Learned Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';

  it('numbers the first rule 001 and inserts it before the end marker', () => {
    const out = appendRuleToContent(EMPTY, {
      problemClass: 'Clicking the modal close button before the fade animation finishes does nothing.',
      rule: 'Wait for the modal to be fully visible before clicking close.',
    });

    expect(out).toContain('## Rule 001 — Clicking the modal close button before the fade animation finishes does nothing');
    expect(out).toContain('**Problem class**: Clicking the modal close button before the fade animation finishes does nothing.');
    expect(out).toContain('**Rule**: Wait for the modal to be fully visible before clicking close.');
    expect(out.indexOf('## Rule 001')).toBeLessThan(out.indexOf('<!-- rules-end -->'));
  });

  it('increments the rule number based on existing ## Rule NNN headings', () => {
    const withTwoRules = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — first\n**Problem class**: a.\n**Rule**: b.\n\n## Rule 002 — second\n**Problem class**: c.\n**Rule**: d.\n<!-- rules-end -->\n`;

    const out = appendRuleToContent(withTwoRules, {
      problemClass: 'Third issue.',
      rule: 'Third fix.',
    });

    expect(out).toContain('## Rule 003 — Third issue');
  });

  it('strips a leading "Problem class:" prefix when deriving the title', () => {
    const out = appendRuleToContent(EMPTY, {
      problemClass: 'Problem class: the dropdown closes before the option is clicked.',
      rule: 'Wait for the dropdown options to be visible before clicking.',
    });

    expect(out).toContain('## Rule 001 — the dropdown closes before the option is clicked');
  });

  it('uses a custom heading prefix, e.g. for framework-rules.md', () => {
    const FW_EMPTY = '# Framework Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';

    const out = appendRuleToContent(
      FW_EMPTY,
      { problemClass: 'Shared CSS classes collide across page regions.', rule: 'Scope to a unique ancestor.' },
      'FW-Rule',
    );

    expect(out).toContain('## FW-Rule 001 — Shared CSS classes collide across page regions');
    expect(out).not.toContain('## Rule 001');
  });

  it('uses an explicit title override instead of deriving one from problemClass', () => {
    const out = appendRuleToContent(EMPTY, {
      problemClass: 'A long, multi-clause description that should NOT become the title.',
      rule: 'Do the fix.',
      title: 'Custom Title',
    });

    const headingLine = out.split('\n').find((l) => l.startsWith('## Rule 001'));
    expect(headingLine).toBe('## Rule 001 — Custom Title');
  });
});

describe('parseRuleEntries', () => {
  it('returns an empty array for content with no rules', () => {
    const EMPTY = '# Learned Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';
    expect(parseRuleEntries(EMPTY)).toEqual([]);
  });

  it('parses a single entry into num/title/problemClass/rule', () => {
    const content = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — Modal close button\n**Problem class**: Clicking close before the fade finishes does nothing.\n**Rule**: Wait for the modal to be visible before clicking close.\n<!-- rules-end -->\n`;

    const entries = parseRuleEntries(content);

    expect(entries).toHaveLength(1);
    expect(entries[0].num).toBe('001');
    expect(entries[0].title).toBe('Modal close button');
    expect(entries[0].problemClass).toBe('Clicking close before the fade finishes does nothing.');
    expect(entries[0].rule).toBe('Wait for the modal to be visible before clicking close.');
  });

  it('preserves a multi-line fenced code block in **Rule** verbatim', () => {
    const content = '# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — Use requestWithRetry\n**Problem class**: API calls intermittently fail with 503 due to rate limiting.\n**Rule**: Wrap the call:\n```typescript\nawait requestWithRetry(() => request.get(\'/api/foo\'));\n```\n<!-- rules-end -->\n';

    const entries = parseRuleEntries(content);

    expect(entries).toHaveLength(1);
    expect(entries[0].rule).toContain('```typescript');
    expect(entries[0].rule).toContain("await requestWithRetry(() => request.get('/api/foo'));");
    expect(entries[0].rule.trim().endsWith('```')).toBe(true);
  });

  it('parses multiple entries in order', () => {
    const content = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — first\n**Problem class**: a.\n**Rule**: b.\n\n## Rule 002 — second\n**Problem class**: c.\n**Rule**: d.\n\n## Rule 003 — third\n**Problem class**: e.\n**Rule**: f.\n<!-- rules-end -->\n`;

    const entries = parseRuleEntries(content);

    expect(entries.map((e) => e.num)).toEqual(['001', '002', '003']);
    expect(entries.map((e) => e.title)).toEqual(['first', 'second', 'third']);
  });

  it('parses entries with a custom heading prefix, e.g. FW-Rule', () => {
    const content = `# Framework Rules\n\n<!-- rules-start -->\n## FW-Rule 001 — Locator collisions\n**Problem class**: A shared CSS class matches multiple elements.\n**Rule**: Scope to a unique ancestor.\n<!-- rules-end -->\n`;

    const entries = parseRuleEntries(content, 'FW-Rule');

    expect(entries).toHaveLength(1);
    expect(entries[0].num).toBe('001');
    expect(entries[0].title).toBe('Locator collisions');
  });
});

describe('removeRuleFromContent', () => {
  const withThreeRules = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — first\n**Problem class**: a.\n**Rule**: b.\n\n## Rule 002 — second\n**Problem class**: c.\n**Rule**: d.\n\n## Rule 003 — third\n**Problem class**: e.\n**Rule**: f.\n<!-- rules-end -->\n`;

  it('removes a middle entry and renumbers subsequent entries sequentially', () => {
    const { content, removed } = removeRuleFromContent(withThreeRules, '002');

    expect(removed?.title).toBe('second');

    const entries = parseRuleEntries(content);
    expect(entries.map((e) => e.num)).toEqual(['001', '002']);
    expect(entries.map((e) => e.title)).toEqual(['first', 'third']);
  });

  it('removes the only entry, leaving an empty rules section', () => {
    const ONE = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — only\n**Problem class**: a.\n**Rule**: b.\n<!-- rules-end -->\n`;

    const { content, removed } = removeRuleFromContent(ONE, '001');

    expect(removed?.title).toBe('only');
    expect(content).toContain('<!-- rules-start -->\n<!-- rules-end -->');
    expect(parseRuleEntries(content)).toEqual([]);
  });

  it('returns the content unchanged and removed: null when num is not found', () => {
    const EMPTY = '# Learned Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';

    const result = removeRuleFromContent(EMPTY, '005');

    expect(result.removed).toBeNull();
    expect(result.content).toBe(EMPTY);
  });
});

describe('promoteRule', () => {
  it('moves a rule from learnedContent to frameworkContent as the next FW-Rule', () => {
    const learnedContent = `# Learned Rules\n\n<!-- rules-start -->\n## Rule 001 — Locator collisions\n**Problem class**: A shared CSS class matches multiple elements.\n**Rule**: Scope to a unique ancestor.\n<!-- rules-end -->\n`;
    const frameworkContent = '# Framework Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';

    const { learnedContent: newLearned, frameworkContent: newFramework, promoted } = promoteRule(
      learnedContent,
      frameworkContent,
      '001',
    );

    expect(promoted?.title).toBe('Locator collisions');
    expect(parseRuleEntries(newLearned)).toEqual([]);

    const fwEntries = parseRuleEntries(newFramework, 'FW-Rule');
    expect(fwEntries).toHaveLength(1);
    expect(fwEntries[0].num).toBe('001');
    expect(fwEntries[0].title).toBe('Locator collisions');
    expect(fwEntries[0].problemClass).toBe('A shared CSS class matches multiple elements.');
    expect(fwEntries[0].rule).toBe('Scope to a unique ancestor.');
  });

  it('returns promoted: null and leaves both contents unchanged when num is not found', () => {
    const learnedContent = '# Learned Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';
    const frameworkContent = '# Framework Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n';

    const result = promoteRule(learnedContent, frameworkContent, '005');

    expect(result.promoted).toBeNull();
    expect(result.learnedContent).toBe(learnedContent);
    expect(result.frameworkContent).toBe(frameworkContent);
  });
});

describe('getSystemPrompt / getSystemBlocks', () => {
  it('finds and parses the real learned-rules.md from the project root', async () => {
    const prompt = await getSystemPrompt();

    expect(prompt).toContain('## Learned rules (from past failure investigations — treat as mandatory)');
    expect(prompt).toContain('## Rule 001');
  });

  it('does not include a Framework rules section while framework-rules.md is empty', async () => {
    const prompt = await getSystemPrompt();

    expect(prompt).not.toContain('## Framework rules');
  });

  it('wraps the prompt as a single cacheable text block', async () => {
    const blocks = await getSystemBlocks();

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].text).toContain('## Rule 001');
  });
});
