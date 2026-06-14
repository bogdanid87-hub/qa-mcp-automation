import { describe, it, expect } from 'vitest';
import { appendRuleToContent, extractRulesSection, getSystemPrompt, getSystemBlocks } from '../prompts/system';

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
});

describe('getSystemPrompt / getSystemBlocks', () => {
  it('finds and parses the real learned-rules.md from the project root', async () => {
    const prompt = await getSystemPrompt();

    expect(prompt).toContain('## Learned rules (from past failure investigations — treat as mandatory)');
    expect(prompt).toContain('## Rule 001');
  });

  it('wraps the prompt as a single cacheable text block', async () => {
    const blocks = await getSystemBlocks();

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].text).toContain('## Rule 001');
  });
});
