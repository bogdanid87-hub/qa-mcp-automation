/**
 * Classifies a tool failure and formats it as a plain-English envelope that
 * slots into the `{ content: [{ type: 'text', text }] }` shape every MCP tool
 * returns. Goal: a non-engineer reading any failure knows what category it
 * falls into and what to do next, without reading stack traces.
 */

export type ErrorCategory = 'config' | 'transient' | 'code_bug' | 'app_bug' | 'unknown';

export interface ErrorEnvelope {
  category: ErrorCategory;
  /** Short header label, e.g. "Configuration problem". */
  label: string;
  /** One-line plain-English description of what went wrong. */
  summary: string;
  /** One actionable sentence telling the reader what to do next. */
  nextStep: string;
  /** MCP tool name, shown in the header. */
  tool?: string;
  /** Raw LLM output / error text, shown in a "Raw response" block (truncated). */
  detail?: string;
}

export interface ClassifyOptions {
  /** Force a category instead of running detectCategory — the only way to get 'app_bug'. */
  category?: ErrorCategory;
  tool?: string;
  detail?: string;
  /** Override the displayed summary without affecting classification (which still reads err.message). */
  summary?: string;
}

const MAX_DETAIL_LENGTH = 4000;

const CONFIG_PATTERNS: RegExp[] = [
  /ANTHROPIC_API_KEY/i,
  /\b401\b/,
  /invalid[- ]?x-api-key/i,
  /authentication_error/i,
  /permission_error/i,
  /mcp-qa\.config\.json/i,
];

const TRANSIENT_PATTERNS: RegExp[] = [
  /\bollama\b/i,
  /localhost:11434/i,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /net::ERR_/,
  /fetch failed/i,
  /\btimeout\b/i,
  /\b(429|500|502|503|504)\b/,
  /overloaded_error/i,
  /rate_limit/i,
];

const CODE_BUG_PATTERNS: RegExp[] = [
  /returned invalid JSON/i,
  /failed to parse/i,
  /no JSON (object|found)/i,
  /invalid JSON/i,
];

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  config: 'Configuration problem',
  transient: 'Temporary problem',
  code_bug: 'Generation problem',
  app_bug: 'Application bug found',
  unknown: 'Unexpected error',
};

const CATEGORY_ICONS: Record<ErrorCategory, string> = {
  config: '⚙️',
  transient: '⏳',
  code_bug: '🔁',
  app_bug: '🐞',
  unknown: '❓',
};

const NEXT_STEPS: Record<ErrorCategory, string> = {
  config:
    'Set ANTHROPIC_API_KEY in your shell profile (or .env) and try again — see ' +
    'README.md "Setup" for where to get a key. If this mentions mcp-qa.config.json, ' +
    'run `npm run init_project` or check that the file exists in the project root.',
  transient:
    'This looks like a temporary connectivity problem, not a bug — wait a moment and ' +
    'try again. If it mentions Ollama/localhost:11434, start it with `open -a Ollama` ' +
    '(or re-run with NO_LOCAL_LLM=1 to skip the local model).',
  code_bug:
    'The AI returned a response this tool could not parse — this is usually transient. ' +
    'Re-run the same command; if it keeps happening, try a shorter or more specific ' +
    'description.',
  app_bug:
    'This is a bug in the application under test, not in your test code — no test ' +
    'changes are needed. Review the description below and track it as a product bug.',
  unknown:
    'Something unexpected went wrong. Re-run the command — if it fails the same way ' +
    'again, copy the full message above (including "Raw response" if shown) when ' +
    'asking for help.',
};

/** First-match-wins, case-insensitive classification of an error message. */
export function detectCategory(message: string): ErrorCategory {
  if (CONFIG_PATTERNS.some((re) => re.test(message))) return 'config';
  if (TRANSIENT_PATTERNS.some((re) => re.test(message))) return 'transient';
  if (CODE_BUG_PATTERNS.some((re) => re.test(message))) return 'code_bug';
  return 'unknown';
}

/** Build a full envelope from an Error (or message string) and options. */
export function classifyError(err: Error | string, opts: ClassifyOptions = {}): ErrorEnvelope {
  const message = typeof err === 'string' ? err : err.message;
  const category = opts.category ?? detectCategory(message);

  let detail = opts.detail;
  if (detail && detail.length > MAX_DETAIL_LENGTH) {
    detail = detail.slice(0, MAX_DETAIL_LENGTH) + '\n... (truncated)';
  }

  return {
    category,
    label: CATEGORY_LABELS[category],
    summary: opts.summary ?? message,
    nextStep: NEXT_STEPS[category],
    tool: opts.tool,
    detail,
  };
}

/** Render an envelope to the final display string. */
export function formatErrorEnvelope(envelope: ErrorEnvelope): string {
  const { category, label, summary, nextStep, tool, detail } = envelope;
  const icon = CATEGORY_ICONS[category];
  const header = tool ? `${icon} ${label} — ${tool}` : `${icon} ${label}`;

  const lines = [header, '', summary, '', `Next step: ${nextStep}`];

  if (detail) {
    lines.push('', 'Raw response (for debugging):', detail);
  }

  return lines.join('\n');
}

/** Convenience: classify + format + wrap in the {content:[...]} shape in one call. */
export function errorContent(
  err: Error | string,
  opts: ClassifyOptions = {},
): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: formatErrorEnvelope(classifyError(err, opts)) }] };
}
