import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getSystemBlocks } from '../prompts/system.js';
import { cleanLlmCode } from './llm-utils.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

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

function extractJson(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try { JSON.parse(stripped); return stripped; } catch { /* */ }
  const lineStart = stripped.search(/(?:^|\n)\s*\{/);
  const start = lineStart !== -1 ? stripped.indexOf('{', lineStart) : stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  throw new Error('No JSON found in response');
}

export async function generateAuthFixtureTool(args: AuthFixtureArgs): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY not set.' }] };

  const client = new Anthropic({ apiKey });
  const systemBlocks = await getSystemBlocks();

  // Read existing files for context
  let existingSetup = '';
  let existingFixtures = '';
  try { existingSetup   = await readFile(GLOBAL_SETUP_PATH, 'utf-8'); } catch { /* new */ }
  try { existingFixtures = await readFile(FIXTURES_PATH, 'utf-8'); } catch { /* new */ }

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
    return { content: [{ type: 'text', text: `Failed to parse response:\n\n${raw}` }] };
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
    await writeFile(setupPath, updated, 'utf-8');
  } else {
    const header = `import { test as setup, chromium } from '@playwright/test';\nimport path from 'path';\n\n`;
    await writeFile(setupPath, header + cleanSetupTask + '\n', 'utf-8');
  }

  // ── Append fixture entry to fixtures/index.ts ───────────────────────────
  if (existingFixtures) {
    const cleanFixture = cleanLlmCode(parsed.fixtureEntry, { stripImports: true });

    // Insert INSIDE the base.extend({...}) object — before the closing '});'
    const closeIdx = existingFixtures.lastIndexOf('\n});');
    const updated = closeIdx !== -1
      ? existingFixtures.slice(0, closeIdx) + '\n\n  ' + cleanFixture.split('\n').join('\n  ') + existingFixtures.slice(closeIdx)
      : existingFixtures.trimEnd() + '\n\n' + cleanFixture + '\n';
    await writeFile(FIXTURES_PATH, updated, 'utf-8');
  }

  // ── Add fixture type to PageFixtures in fixtures/index.ts ────────────────
  const fixtureTypeLine = parsed.fixtureType ?? `${args.name}Page: Page`;
  const currentFixtures = await readFile(FIXTURES_PATH, 'utf-8').catch(() => '');
  if (currentFixtures && !currentFixtures.includes(fixtureTypeLine)) {
    // Insert into the PageFixtures type block — find the closing '};' of the type
    const typeClose = currentFixtures.indexOf('};', currentFixtures.indexOf('type PageFixtures'));
    if (typeClose !== -1) {
      const updated = currentFixtures.slice(0, typeClose) + `  ${fixtureTypeLine};\n` + currentFixtures.slice(typeClose);
      await writeFile(FIXTURES_PATH, updated, 'utf-8');
    }
  }

  // ── Add storage state path to .gitignore ────────────────────────────────
  const gitignorePath = join(ROOT, '.gitignore');
  try {
    const gi = await readFile(gitignorePath, 'utf-8');
    if (!gi.includes(parsed.storageStatePath)) {
      await writeFile(gitignorePath, gi.trimEnd() + '\n' + parsed.storageStatePath + '\n', 'utf-8');
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
