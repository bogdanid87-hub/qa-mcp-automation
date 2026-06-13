import Anthropic from '@anthropic-ai/sdk';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { getSystemBlocks } from '../prompts/system.js';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';
import { cleanLlmCode, extractJson } from './llm-utils.js';
import { safeWrite } from '../lib/safe-write.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';
const MOCKS_DIR = join(ROOT, 'fixtures', 'mocks');

export interface GenerateMockArgs {
  // URL pattern to intercept, e.g. '**\/api/products' or 'https://api.stripe.com/**'
  urlPattern: string;
  /** HTTP method to intercept */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';
  /** HTTP status code to return */
  status?: number;
  /** Response body — describe it in plain English or provide JSON */
  responseBody: string;
  /** Name for the generated mock, e.g. 'stripeSuccess', 'productSearchResults' */
  name: string;
  /**
   * Where the mock should live:
   *   'fixture'  — shared fixture, importable by any test (default)
   *   'inline'   — code snippet for use directly inside a test
   */
  scope?: 'fixture' | 'inline';
  /** Extra context, e.g. "this simulates a Stripe 402 payment required error" */
  notes?: string;
}

const TASK_PROMPT = (args: GenerateMockArgs) => `\
Generate a Playwright network mock (page.route() handler) for this project.

## Mock name
${args.name}

## What to intercept
- URL pattern: ${args.urlPattern}
- Method: ${args.method ?? '*'}
- Status: ${args.status ?? 200}

## Response body
${args.responseBody}

${args.notes ? `## Additional context\n${args.notes}\n` : ''}
## Scope
${args.scope === 'inline'
  ? 'Inline — generate a self-contained code snippet the developer pastes inside a test() body'
  : 'Fixture — generate a reusable fixture function in fixtures/mocks/ that any test can import'
}

## What to generate for a FIXTURE scope mock

### 1. fixtures/mocks/${args.name}.ts
A TypeScript module exporting a setup function:
\`\`\`typescript
// fixtures/mocks/${args.name}.ts
import { Page } from '@playwright/test';

export async function mock${capitalise(args.name)}(page: Page): Promise<void> {
  await page.route('${args.urlPattern}', async route => {
    await route.fulfill({
      status: ${args.status ?? 200},
      contentType: 'application/json',
      body: JSON.stringify({ /* ... */ }),
    });
  });
}
\`\`\`

### 2. Usage example
Show how to call the mock inside a test.

## What to generate for an INLINE scope mock
A code snippet to paste directly inside a test body — no separate file.

## Rules
- Use page.route() not context.route() unless the mock must persist across navigations
- Always set contentType: 'application/json' for JSON responses
- Use route.fulfill() for complete responses; route.abort() to simulate network errors
- Add a companion \`unmock${capitalise(args.name)}\` function that calls page.unroute()
  so tests can restore the real endpoint mid-test
- Keep body realistic — use the same field names and types as the real API
- Never use real third-party credentials or API keys in the mock response

Respond with raw JSON only (no markdown fences):
{
  "summary": "one-sentence description of what the mock does",
  "scope": "${args.scope ?? 'fixture'}",
  "fileName": "fixtures/mocks/${args.name}.ts",
  "fileContent": "full TypeScript file content",
  "usageExample": "code snippet showing how to use this mock in a test"
}
`;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


export async function generateMockTool(args: GenerateMockArgs): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY not set.' }] };

  const prompt = TASK_PROMPT(args);
  const systemBlocks = await getSystemBlocks();
  const systemText = systemBlocks.map(b => (b as { type: 'text'; text: string }).text).join('\n');

  // ── Generate — local LLM first, Claude fallback ──────────────────────────
  const localAvailable = await isLocalLlmAvailable();
  let generatedBy = 'Claude API';
  let raw: string;

  if (localAvailable) {
    try {
      raw = await callLocalLlm(systemText, prompt);
      extractJson(raw); // validate — throws if not parseable
      generatedBy = LOCAL_MODEL;
    } catch {
      process.stderr.write(`[local-llm] mock generation failed — falling back to Claude API\n`);
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: MODEL, max_tokens: 2048,
        system: systemBlocks,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
    }
  } else {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL, max_tokens: 2048,
      system: systemBlocks,
      messages: [{ role: 'user', content: prompt }],
    });
    raw = msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
  }

  let parsed: {
    summary: string;
    scope: string;
    fileName: string;
    fileContent: string;
    usageExample: string;
  };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { content: [{ type: 'text', text: `Failed to parse response:\n\n${raw}` }] };
  }

  const lines: string[] = [`✅ ${parsed.summary}`, `   Generated by: ${generatedBy}`, ''];

  const cleanContent = cleanLlmCode(parsed.fileContent) + '\n';

  if (parsed.scope === 'fixture') {
    const filePath = join(ROOT, parsed.fileName);
    await mkdir(MOCKS_DIR, { recursive: true });
    const result = await safeWrite(filePath, cleanContent);
    if (result.ok) {
      lines.push(`**File written:** ${parsed.fileName}`, '');
    } else {
      lines.push(`⛔ Skipped writing ${parsed.fileName} — ${result.reason}`, '');
    }
  } else {
    lines.push('**Inline snippet (paste inside your test body):**', '```typescript', cleanContent, '```', '');
  }

  lines.push('**Usage example:**', '```typescript', parsed.usageExample, '```');

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
