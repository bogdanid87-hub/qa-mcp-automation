import { readFile } from 'fs/promises';
import { join } from 'path';
import * as readline from 'readline';
import { generateAuthFixtureTool, type AuthFixtureArgs } from './tools/generate-auth-fixture.js';

const ROOT = process.cwd();

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); }));
}

function parseArgs(argv: string[]): Partial<AuthFixtureArgs> & { help?: boolean } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return {
    type:              raw['type'] as 'form' | 'oauth' | undefined,
    name:              raw['name'],
    loginUrl:          raw['login-url'] ?? raw['url'],
    emailSelector:     raw['email-selector'],
    passwordSelector:  raw['password-selector'],
    submitSelector:    raw['submit-selector'],
    successIndicator:  raw['success'],
    usernameEnvVar:    raw['username-env'] ?? raw['email-env'],
    passwordEnvVar:    raw['password-env'],
    notes:             raw['notes'],
  };
}

async function main(): Promise<void> {
  await ensureApiKey();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nError: ANTHROPIC_API_KEY is not set.\n');
    process.exit(1);
  }

  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: npm run generate_auth -- [options]

The login fields are auto-detected from the page — you usually only need
--name and --login-url. Pass selectors only to override the auto-detection.

Options:
  --type <form|oauth>        Auth type (default: form)
  --name <name>              Name for this logged-in state, e.g. "loggedIn", "admin"
  --login-url <url>          Login page URL or path
  --email-selector <sel>     (optional) Override the auto-detected email/username field
  --password-selector <sel>  (optional) Override the auto-detected password field
  --submit-selector <sel>    (optional) Override the auto-detected submit button
  --success <indicator>      URL pattern or selector shown after successful login
  --username-env <VAR>       Env var holding the username/email
  --password-env <VAR>       Env var holding the password
  --notes <text>             Extra context for the generator

Example (fields auto-detected):
  npm run generate_auth -- --type form --name loggedIn --login-url /login \\
    --username-env TEST_EMAIL --password-env TEST_PASSWORD

Example (overriding the auto-detection):
  npm run generate_auth -- --type form --name loggedIn --login-url /login \\
    --email-selector '[data-qa="login-email"]' \\
    --password-selector '[data-qa="login-password"]' \\
    --submit-selector '[data-qa="login-button"]'
`);
    process.exit(0);
  }

  // Interactive prompts for missing required values
  const type     = flags.type ?? (await ask('Auth type [form/oauth] (default: form): ') || 'form') as 'form' | 'oauth';
  const name     = flags.name ?? await ask('Fixture name (e.g. "loggedIn", "admin"): ');
  const loginUrl = flags.loginUrl ?? await ask('Login page URL or path: ');

  if (!name) { console.error('Error: fixture name is required.'); process.exit(1); }
  if (!loginUrl) { console.error('Error: login URL is required.'); process.exit(1); }

  const args: AuthFixtureArgs = {
    type,
    name,
    loginUrl,
    emailSelector:    flags.emailSelector,
    passwordSelector: flags.passwordSelector,
    submitSelector:   flags.submitSelector,
    successIndicator: flags.successIndicator,
    usernameEnvVar:   flags.usernameEnvVar,
    passwordEnvVar:   flags.passwordEnvVar,
    notes:            flags.notes,
  };

  console.log('\n⏳ Generating auth fixture...\n');
  const result = await generateAuthFixtureTool(args);
  console.log(result.content[0]?.text ?? '(no output)');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
