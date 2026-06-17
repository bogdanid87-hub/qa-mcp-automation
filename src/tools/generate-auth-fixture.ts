import Anthropic from '@anthropic-ai/sdk';
import { readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getSystemBlocks } from '../prompts/system.js';
import { cleanLlmCode, extractJson } from './llm-utils.js';
import { safeWrite } from '../lib/safe-write.js';
import { errorContent } from '../lib/format-error.js';
import { config } from '../config.js';

const ROOT = process.cwd();
const MODEL = config.models.primary;

const GLOBAL_SETUP_PATH = join(ROOT, 'tests', 'global.setup.ts');
const FIXTURES_PATH     = join(ROOT, 'fixtures', 'index.ts');

export interface AuthFixtureArgs {
  /** 'form' = username/password form; 'oauth' = OAuth/OIDC redirect flow */
  type: 'form' | 'oauth';
  /** Label for this auth state, e.g. 'admin', 'loggedIn', 'premiumUser' */
  name: string;
  /** URL of the login page (for form auth) or OAuth provider (for oauth) */
  loginUrl: string;
  /** CSS/data-qa selector for the email/username input */
  emailSelector?: string;
  /** CSS/data-qa selector for the password input */
  passwordSelector?: string;
  /** CSS/data-qa selector for the submit button */
  submitSelector?: string;
  /** Selector or URL pattern that indicates successful login */
  successIndicator?: string;
  /** Environment variable name holding the username/email */
  usernameEnvVar?: string;
  /** Environment variable name holding the password */
  passwordEnvVar?: string;
  /** Extra context for Claude (e.g. "the login form is inside an iframe") */
  notes?: string;
}

const TASK_PROMPT = (args: AuthFixtureArgs) => `\
Generate Playwright auth fixture code for this project.

## Auth type
${args.type === 'form' ? 'Form-based login (username + password)' : 'OAuth / OIDC redirect flow'}

## Fixture name
"${args.name}" — e.g. this will be exposed as \`${args.name}Page\` in tests

## Login details
- Login URL: ${args.loginUrl}
${args.emailSelector ? `- Email/username selector: ${args.emailSelector}` : ''}
${args.passwordSelector ? `- Password selector: ${args.passwordSelector}` : ''}
${args.submitSelector ? `- Submit button: ${args.submitSelector}` : ''}
${args.successIndicator ? `- Success indicator (URL or selector): ${args.successIndicator}` : ''}
${args.usernameEnvVar ? `- Username env var: process.env.${args.usernameEnvVar}` : ''}
${args.passwordEnvVar ? `- Password env var: process.env.${args.passwordEnvVar}` : ''}
${args.notes ? `\n## Additional context\n${args.notes}` : ''}

## What to generate

### 1. global.setup.ts addition
Generate a NEW setup task (alongside the existing guest setup if it exists) that:
- Opens a fresh browser context
- Navigates to the login page
- Fills credentials (read from env vars — NEVER hardcode credentials)
- Waits for the success indicator
- Saves storageState to: test-data/.auth/${args.name}.json
- Closes the browser

### 2. Fixture entry
Generate the fixture entry to add to fixtures/index.ts:
- Named \`${args.name}Page\` (type: the relevant Page class, or generic Page)
- Applies storageState: 'test-data/.auth/${args.name}.json'
- Usage: async ({ ${args.name}Page }, use) => { await use(new SomePage(${args.name}Page)) }

### 3. .env.example additions
Show the env var entries to add to .env.example

## Rules
- Use waitForLoadState('domcontentloaded') not 'load'
- NEVER hardcode credentials — always read from env vars
- Add the storageState path to .gitignore if not already there
- The setup task name must be unique from 'save guest storage state'
- Follow the same patterns as the existing global.setup.ts in this project

Respond with raw JSON only (no markdown fences):
{
  "summary": "one-sentence description of what was generated",
  "setupTask": "full TypeScript code for the new setup task function (no import statements — they already exist at the top of the file)",
  "fixtureEntry": "TypeScript code for just the fixture property (e.g. loggedInPage: async ({ browser }, use) => { ... },) — no imports, no type declarations",
  "fixtureType": "${args.name}Page: Page",
  "envVars": ["VAR_NAME=description of value", "..."],
  "storageStatePath": "test-data/.auth/${args.name}.json"
}
`;


/** True if fixtures/index.ts already declares a fixture named `fixtureName`. */
export function fixtureNameInUse(fixtures: string, fixtureName: string): boolean {
  const escaped = fixtureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b\\s*:`).test(fixtures);
}

/**
 * Ensure `Page` is imported from @playwright/test when `fixtureTypeLine` uses the
 * generic `Page` type — the scaffolded fixtures only import `test as base`, so a
 * `<name>Page: Page` entry otherwise fails with "Cannot find name 'Page'". Pure.
 */
export function ensurePageImport(fixtures: string, fixtureTypeLine: string): string {
  if (!/:\s*Page\b/.test(fixtureTypeLine)) return fixtures;
  const alreadyImports = /import\s+(?:type\s+)?\{[^}]*\bPage\b[^}]*\}\s+from\s+['"]@playwright\/test['"]/.test(fixtures);
  const firstImportEnd = fixtures.indexOf('\n', fixtures.indexOf('import '));
  if (alreadyImports || firstImportEnd === -1) return fixtures;
  return (
    fixtures.slice(0, firstImportEnd + 1) +
    `import type { Page } from '@playwright/test';\n` +
    fixtures.slice(firstImportEnd + 1)
  );
}

export async function generateAuthFixtureTool(args: AuthFixtureArgs): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return errorContent('Error: ANTHROPIC_API_KEY not set.', { category: 'config', tool: 'generate_auth_fixture' });

  const client = new Anthropic({ apiKey });
  const systemBlocks = await getSystemBlocks();

  // Read existing files for context
  let existingSetup = '';
  let existingFixtures = '';
  try { existingSetup   = await readFile(GLOBAL_SETUP_PATH, 'utf-8'); } catch { /* new */ }
  try { existingFixtures = await readFile(FIXTURES_PATH, 'utf-8'); } catch { /* new */ }

  // Guard: refuse to add a fixture whose name already exists — appending it blindly
  // produces a fixtures/index.ts with a duplicate key that doesn't compile. (A POM
  // fixture and an auth fixture can collide, e.g. an AdminPage POM's `adminPage`
  // fixture vs. `--name admin`.) Abort before spending a Claude call.
  const fixtureName = `${args.name}Page`;
  if (existingFixtures && fixtureNameInUse(existingFixtures, fixtureName)) {
    return { content: [{ type: 'text', text:
      `⚠️  A fixture named \`${fixtureName}\` already exists in fixtures/index.ts — ` +
      `adding another would produce a duplicate that doesn't compile. ` +
      `Pick a different name (e.g. \`--name ${args.name}Auth\`, exposing \`${args.name}AuthPage\`) ` +
      `or remove the existing fixture first. No files were changed.`,
    }] };
  }

  const contextBlock = [
    existingSetup   ? `## Existing global.setup.ts\n\`\`\`typescript\n${existingSetup}\n\`\`\`` : '',
    existingFixtures ? `## Existing fixtures/index.ts\n\`\`\`typescript\n${existingFixtures}\n\`\`\`` : '',
  ].filter(Boolean).join('\n\n');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [{
      role: 'user',
      content: contextBlock
        ? `${contextBlock}\n\n---\n\n${TASK_PROMPT(args)}`
        : TASK_PROMPT(args),
    }],
  });

  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: {
    summary: string;
    setupTask: string;
    fixtureEntry: string;
    fixtureType?: string;
    envVars: string[];
    storageStatePath: string;
  };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return errorContent('Failed to parse the generated auth fixture response.', { tool: 'generate_auth_fixture', detail: raw });
  }

  // ── Write global.setup.ts ────────────────────────────────────────────────
  const setupPath = GLOBAL_SETUP_PATH;
  const storageDir = join(ROOT, dirname(parsed.storageStatePath));

  await mkdir(storageDir, { recursive: true });
  await mkdir(join(ROOT, 'tests'), { recursive: true });

  const cleanSetupTask = cleanLlmCode(parsed.setupTask, {
    stripImports: !!existingSetup, // only strip imports when appending to existing file
  });

  if (existingSetup) {
    const updated = existingSetup.trimEnd() + '\n\n' + cleanSetupTask + '\n';
    const result = await safeWrite(setupPath, updated);
    if (!result.ok) process.stderr.write(`[generate-auth-fixture] skipping global.setup.ts update — ${result.reason}\n`);
  } else {
    const header = `import { test as setup, chromium } from '@playwright/test';\nimport path from 'path';\n\n`;
    await safeWrite(setupPath, header + cleanSetupTask + '\n');
  }

  // ── Append fixture entry to fixtures/index.ts ───────────────────────────
  if (existingFixtures) {
    const cleanFixture = cleanLlmCode(parsed.fixtureEntry, { stripImports: true });

    // Insert INSIDE the base.extend({...}) object — before the closing '});'
    const closeIdx = existingFixtures.lastIndexOf('\n});');
    const updated = closeIdx !== -1
      ? existingFixtures.slice(0, closeIdx) + '\n\n  ' + cleanFixture.split('\n').join('\n  ') + existingFixtures.slice(closeIdx)
      : existingFixtures.trimEnd() + '\n\n' + cleanFixture + '\n';
    const result = await safeWrite(FIXTURES_PATH, updated);
    if (!result.ok) process.stderr.write(`[generate-auth-fixture] skipping fixtures/index.ts fixture-entry update — ${result.reason}\n`);
  }

  // ── Add fixture type to PageFixtures in fixtures/index.ts ────────────────
  const fixtureTypeLine = parsed.fixtureType ?? `${args.name}Page: Page`;
  const currentFixtures = await readFile(FIXTURES_PATH, 'utf-8').catch(() => '');
  if (currentFixtures && !currentFixtures.includes(fixtureTypeLine)) {
    // Insert into the PageFixtures type block — find the closing '};' of the type
    const typeClose = currentFixtures.indexOf('};', currentFixtures.indexOf('type PageFixtures'));
    if (typeClose !== -1) {
      const updated = currentFixtures.slice(0, typeClose) + `  ${fixtureTypeLine};\n` + currentFixtures.slice(typeClose);
      const result = await safeWrite(FIXTURES_PATH, updated);
      if (!result.ok) process.stderr.write(`[generate-auth-fixture] skipping fixtures/index.ts type update — ${result.reason}\n`);
    }
  }

  // ── Ensure `Page` is imported when the fixture type uses the generic Page ──
  const withType = await readFile(FIXTURES_PATH, 'utf-8').catch(() => '');
  const withImport = ensurePageImport(withType, fixtureTypeLine);
  if (withType && withImport !== withType) {
    const result = await safeWrite(FIXTURES_PATH, withImport);
    if (!result.ok) process.stderr.write(`[generate-auth-fixture] skipping fixtures/index.ts Page-import update — ${result.reason}\n`);
  }

  // ── Add storage state path to .gitignore ────────────────────────────────
  const gitignorePath = join(ROOT, '.gitignore');
  try {
    const gi = await readFile(gitignorePath, 'utf-8');
    if (!gi.includes(parsed.storageStatePath)) {
      await safeWrite(gitignorePath, gi.trimEnd() + '\n' + parsed.storageStatePath + '\n');
    }
  } catch { /* no .gitignore */ }

  const lines = [
    `✅ ${parsed.summary}`,
    '',
    '**Files updated:**',
    `  - tests/global.setup.ts — new setup task added`,
    `  - fixtures/index.ts — ${args.name}Page fixture added`,
    `  - .gitignore — ${parsed.storageStatePath} excluded`,
    '',
    '**Add to .env (never commit these):**',
    ...parsed.envVars.map(v => `  ${v}`),
    '',
    '**Run the setup to generate the auth state:**',
    '```bash',
    'npx playwright test --project=setup',
    '```',
    '',
    '**Use in tests:**',
    '```typescript',
    `test('...', async ({ ${args.name}Page }) => {`,
    '  // page is already authenticated',
    '});',
    '```',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
