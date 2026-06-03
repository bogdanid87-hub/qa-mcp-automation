import { describe, it, expect } from 'vitest';
import { stripFences, stripImports, cleanLlmCode, extractJson } from '../tools/llm-utils';

describe('stripFences', () => {
  it('strips ```typescript fences', () => {
    expect(stripFences('```typescript\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips ```ts fences', () => {
    expect(stripFences('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips plain ``` fences', () => {
    expect(stripFences('```\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips ```js fences', () => {
    expect(stripFences('```js\nconsole.log(1);\n```')).toBe('console.log(1);');
  });

  it('is a no-op on code without fences', () => {
    expect(stripFences('const x = 1;')).toBe('const x = 1;');
  });

  it('trims surrounding whitespace', () => {
    expect(stripFences('  const x = 1;  ')).toBe('const x = 1;');
  });
});

describe('stripImports', () => {
  it('removes import lines', () => {
    const input = "import { foo } from 'bar';\nconst x = 1;";
    expect(stripImports(input)).toBe('const x = 1;');
  });

  it('removes multiple import lines', () => {
    const input = "import a from 'a';\nimport { b } from 'b';\nconst x = 1;";
    expect(stripImports(input)).toBe('const x = 1;');
  });

  it('keeps non-import lines untouched', () => {
    expect(stripImports('const x = 1;\nconst y = 2;')).toBe('const x = 1;\nconst y = 2;');
  });

  it('removes leading blank lines left by removed imports', () => {
    const input = "import { foo } from 'bar';\n\nconst x = 1;";
    expect(stripImports(input)).toBe('const x = 1;');
  });
});

describe('cleanLlmCode', () => {
  it('strips fences by default', () => {
    expect(cleanLlmCode('```typescript\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips imports when requested', () => {
    const raw = "```typescript\nimport { foo } from 'bar';\nconst x = 1;\n```";
    expect(cleanLlmCode(raw, { stripImports: true })).toBe('const x = 1;');
  });

  it('keeps imports when not requested', () => {
    const raw = "```typescript\nimport { foo } from 'bar';\nconst x = 1;\n```";
    expect(cleanLlmCode(raw)).toContain("import { foo } from 'bar';");
  });
});

describe('extractJson', () => {
  it('returns clean JSON directly', () => {
    const input = '{"key": "value"}';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('strips ```json fences', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('strips plain ``` fences', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('extracts JSON from preamble prose', () => {
    const input = 'Here is the response you asked for:\n{"key": "value"}';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('extracts JSON from preamble + fences', () => {
    const input = 'Sure! Here:\n```json\n{"key": "value"}\n```\nLet me know if you need more.';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('handles nested objects', () => {
    const input = '{"outer": {"inner": 42}}';
    expect(JSON.parse(extractJson(input))).toEqual({ outer: { inner: 42 } });
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('No JSON here at all')).toThrow();
  });

  it('does not match an inline { in prose as JSON start', () => {
    // The { in "e.g. {options}" is inline — the real JSON starts on its own line
    const input = 'Use an object like {options} to configure it.\n{"key": "value"}';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });
});
