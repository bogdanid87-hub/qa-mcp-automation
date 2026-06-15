import { describe, it, expect } from 'vitest';
import {
  detectCategory,
  classifyError,
  formatErrorEnvelope,
  errorContent,
  type ErrorCategory,
} from '../lib/format-error';

describe('detectCategory', () => {
  const cases: [string, ErrorCategory][] = [
    // config
    ['ANTHROPIC_API_KEY environment variable is not set.', 'config'],
    [
      'Claude API error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      'config',
    ],
    [
      'Claude API error: 403 {"type":"error","error":{"type":"permission_error","message":"denied"}}',
      'config',
    ],
    ['mcp-qa.config.json not found in project root', 'config'],

    // transient
    [
      'Claude API error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      'transient',
    ],
    ['connect ECONNREFUSED 127.0.0.1:11434', 'transient'],
    ['Ollama returned an error', 'transient'],
    ['fetch failed', 'transient'],
    ['request timeout after 30000ms', 'transient'],
    ['Claude API error: 503 Service Unavailable', 'transient'],
    ['rate_limit_error: too many requests', 'transient'],
    ['net::ERR_CONNECTION_REFUSED at https://example.com', 'transient'],

    // code_bug
    ['Claude returned invalid JSON in POM step.', 'code_bug'],
    [
      'POM step failed: local LLM returned invalid JSON and Claude fallback also failed.',
      'code_bug',
    ],
    ['failed to parse model response', 'code_bug'],
    ['no JSON object found in response', 'code_bug'],

    // unknown fallback
    ['Something completely unexpected happened', 'unknown'],
  ];

  for (const [message, expected] of cases) {
    it(`classifies "${message}" as ${expected}`, () => {
      expect(detectCategory(message)).toBe(expected);
    });
  }

  it('config takes precedence over transient (both could match)', () => {
    // contains both "ANTHROPIC_API_KEY" (config) and "timeout" (transient)
    expect(detectCategory('ANTHROPIC_API_KEY is not set; request timeout')).toBe('config');
  });

  it('transient takes precedence over code_bug (both could match)', () => {
    // contains both "503" (transient) and "invalid JSON" (code_bug)
    expect(detectCategory('Claude API error: 503 — also returned invalid JSON')).toBe(
      'transient',
    );
  });
});

describe('classifyError', () => {
  it('accepts a plain string', () => {
    const envelope = classifyError('ANTHROPIC_API_KEY environment variable is not set.');
    expect(envelope.category).toBe('config');
    expect(envelope.summary).toBe('ANTHROPIC_API_KEY environment variable is not set.');
  });

  it('accepts an Error instance', () => {
    const envelope = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    expect(envelope.category).toBe('transient');
    expect(envelope.summary).toBe('connect ECONNREFUSED 127.0.0.1:11434');
  });

  it('opts.category overrides detection', () => {
    const envelope = classifyError('Claude returned invalid JSON.', { category: 'app_bug' });
    expect(envelope.category).toBe('app_bug');
    expect(envelope.label).toBe('Application bug found');
  });

  it('opts.summary overrides displayed text without affecting classification', () => {
    const err = new Error('503 Service Unavailable');
    const envelope = classifyError(err, {
      summary: 'Claude API error (POM step): 503 Service Unavailable',
    });
    expect(envelope.category).toBe('transient');
    expect(envelope.summary).toBe('Claude API error (POM step): 503 Service Unavailable');
  });

  it('truncates detail at 4000 characters', () => {
    const longDetail = 'x'.repeat(5000);
    const envelope = classifyError('Claude returned invalid JSON.', { detail: longDetail });
    expect(envelope.detail!.length).toBeLessThan(5000);
    expect(envelope.detail!.startsWith('x'.repeat(4000))).toBe(true);
    expect(envelope.detail).toContain('truncated');
  });

  it('does not truncate detail under the limit', () => {
    const shortDetail = 'short raw response';
    const envelope = classifyError('Claude returned invalid JSON.', { detail: shortDetail });
    expect(envelope.detail).toBe(shortDetail);
  });

  const categories: ErrorCategory[] = ['config', 'transient', 'code_bug', 'app_bug', 'unknown'];
  for (const category of categories) {
    it(`${category} has a non-empty nextStep`, () => {
      const envelope = classifyError('some message', { category });
      expect(envelope.nextStep.length).toBeGreaterThan(0);
    });
  }
});

describe('formatErrorEnvelope', () => {
  it('includes the tool name in the header when set', () => {
    const text = formatErrorEnvelope(
      classifyError('ANTHROPIC_API_KEY is not set.', { tool: 'plan_e2e' }),
    );
    expect(text).toContain('⚙️ Configuration problem — plan_e2e');
  });

  it('omits the tool suffix when not set', () => {
    const text = formatErrorEnvelope(classifyError('ANTHROPIC_API_KEY is not set.'));
    expect(text.split('\n')[0]).toBe('⚙️ Configuration problem');
  });

  it('includes a "Raw response" section iff detail is set', () => {
    const withDetail = formatErrorEnvelope(
      classifyError('Claude returned invalid JSON.', { detail: '{garbage' }),
    );
    expect(withDetail).toContain('Raw response (for debugging):');
    expect(withDetail).toContain('{garbage');

    const withoutDetail = formatErrorEnvelope(classifyError('Claude returned invalid JSON.'));
    expect(withoutDetail).not.toContain('Raw response');
  });

  it('always includes a "Next step:" line', () => {
    const text = formatErrorEnvelope(classifyError('some message'));
    expect(text).toContain('Next step:');
  });

  const icons: [ErrorCategory, string][] = [
    ['config', '⚙️'],
    ['transient', '⏳'],
    ['code_bug', '🔁'],
    ['app_bug', '🐞'],
    ['unknown', '❓'],
  ];
  for (const [category, icon] of icons) {
    it(`uses ${icon} for ${category}`, () => {
      const text = formatErrorEnvelope(classifyError('some message', { category }));
      expect(text.startsWith(icon)).toBe(true);
    });
  }
});

describe('errorContent', () => {
  it('wraps the formatted envelope in the {content:[...]} shape', () => {
    const result = errorContent('ANTHROPIC_API_KEY is not set.', { tool: 'analyze_prd' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('⚙️ Configuration problem — analyze_prd');
  });

  it('accepts an Error straight from a catch block', () => {
    let result: ReturnType<typeof errorContent>;
    try {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    } catch (err: any) {
      result = errorContent(err, { tool: 'generate_test' });
    }
    expect(result.content[0].text).toContain('⏳ Temporary problem — generate_test');
  });
});
