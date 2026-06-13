/**
 * Sensitive environment variables whose literal *values* must never appear in
 * generated code. These are the credentials `generate_auth_fixture` tells users
 * to read via `process.env.*` (see docs/generate-auth-fixture.md) plus the
 * Claude API key.
 */
const SENSITIVE_ENV_VARS = ['ANTHROPIC_API_KEY', 'TEST_EMAIL', 'TEST_PASSWORD'];

/**
 * Values shorter than this are skipped — short values (e.g. "qa", "test")
 * are common substrings of legitimate generated code and would cause
 * constant false positives.
 */
const MIN_ENV_VALUE_LENGTH = 6;

/** Secret-shaped patterns that should never appear in generated code, regardless of env. */
const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/, label: 'an API key (sk-...)' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'an AWS access key ID' },
  { re: /gh[pousr]_[A-Za-z0-9]{36,}/, label: 'a GitHub token' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'a private key' },
];

export interface SecretMatch {
  /** Human-readable description of what was found, for the refusal message. */
  label: string;
  /** Redacted excerpt — safe to include in error output. */
  excerpt: string;
}

/** Redact a matched value so it's safe to surface in a refusal message. */
function redact(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

/**
 * Scan generated file content for hardcoded secrets:
 *  - the literal value of any `SENSITIVE_ENV_VARS` entry currently set in
 *    `process.env` (catches a generator inlining `TEST_PASSWORD` etc. instead
 *    of emitting `process.env.TEST_PASSWORD`)
 *  - generic secret-shaped strings (API keys, AWS keys, GitHub tokens, PEM
 *    private key headers) regardless of environment
 *
 * Returns an empty array if nothing was found.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const name of SENSITIVE_ENV_VARS) {
    const value = process.env[name];
    if (value && value.length >= MIN_ENV_VALUE_LENGTH && content.includes(value)) {
      matches.push({ label: `the value of $${name}`, excerpt: redact(value) });
    }
  }

  for (const { re, label } of SECRET_PATTERNS) {
    const m = content.match(re);
    if (m) matches.push({ label, excerpt: redact(m[0]) });
  }

  return matches;
}
