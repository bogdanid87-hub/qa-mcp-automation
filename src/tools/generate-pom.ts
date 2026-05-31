import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { isLocalLlmAvailable, callLocalLlm, LOCAL_MODEL } from './local-llm.js';

const ROOT = process.cwd();
const MODEL = 'claude-sonnet-4-6';

// Focused system prompt — much shorter than the full test-generation prompt so
// the local 14B model can handle it accurately without context overload.
const SYSTEM_PROMPT = `\
You are a Playwright Page Object Model generator for automationexercise.com.

Given a live DOM snapshot of a single page, output a TypeScript POM class containing
ONLY locator properties — no async methods of any kind.

## Output structure
import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class SomePage extends BasePage {
  readonly propName: Locator;

  constructor(page: Page) {
    super(page);
    this.propName = page.locator('[data-qa="..."]');
  }
}

## Locator priority (strict order)
1. page.locator('[data-qa="..."]')   ← always first when data-qa exists
2. page.getByRole(...)
3. page.getByLabel(...)
4. page.getByPlaceholder(...)
5. page.getByText(...)
6. page.locator('#id')

## What to include
- All interactive elements: inputs, buttons, links, selects, textareas
- Key assertion targets: success/error messages, headings, modal containers
- Skip purely decorative elements (icons, decorative images, ads)

## Naming conventions
- camelCase: emailInput, loginButton, errorMessage, cartHeading
- Suffixes: Input, Button, Link, Message, Heading, Modal

## Hard constraints
- NO async methods of any kind
- Named export only — never "export default class"
- BasePage is a named export: import { BasePage } from './BasePage'

## Output format
Raw JSON only (no markdown fences, no explanation):
{
  "file": "pages/SomePage.ts",
  "content": "full TypeScript file content"
}`;

function extractJson(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try { JSON.parse(stripped); return stripped; } catch { /* */ }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  throw new Error('No JSON object found');
}

async function generateForSnapshot(opts: {
  path: string;
  domText: string;
  nameHint?: string;
  apiKey: string;
  localAvailable: boolean;
}): Promise<{ file: string; content: string } | null> {
  const nameHint = opts.nameHint ? `\n\nClass name to use: ${opts.nameHint}` : '';
  const userPrompt = `Generate a locator-only POM for the page at ${opts.path}.${nameHint}\n\n${opts.domText}`;

  if (opts.localAvailable) {
    try {
      const raw = await callLocalLlm(SYSTEM_PROMPT, userPrompt);
      const parsed = JSON.parse(extractJson(raw)) as { file: string; content: string };
      if (parsed.file && parsed.content) return parsed;
      process.stderr.write(`[local-llm] POM response missing file/content fields — falling back to Claude API\n`);
    } catch (err) {
      process.stderr.write(`[local-llm] POM generation failed (${(err as Error).message}) — falling back to Claude API\n`);
    }
  }

  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');
    const parsed = JSON.parse(extractJson(raw)) as { file: string; content: string };
    if (parsed.file && parsed.content) return parsed;
  } catch { /* */ }

  return null;
}

// Guard: skip files that already have methods (they've been promoted by generate_test
// and should not be touched by this tool). For locator-only files, reject if any
// existing readonly Locator property would be dropped.
async function writeWithLocatorGuard(
  file: string,
  content: string,
): Promise<{ ok: boolean; reason?: string }> {
  const abs = join(ROOT, file);
  try {
    const existing = await readFile(abs, 'utf-8');
    if (/async \w+\s*\(/.test(existing)) {
      return { ok: false, reason: 'file already has methods — use generate_test to extend it' };
    }
    const existingProps = [...existing.matchAll(/readonly (\w+):\s*Locator/g)].map(m => m[1]);
    const missing = existingProps.filter(name => !content.includes(`readonly ${name}:`));
    if (missing.length > 0) {
      return { ok: false, reason: `would remove existing locators: ${missing.join(', ')}` };
    }
  } catch { /* new file — no guard needed */ }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf-8');
  return { ok: true };
}

export async function generatePomTool(args: {
  urls: string[];
  page_name?: string;
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY is not set.' }] };
  }

  const localAvailable = await isLocalLlmAvailable();

  let snapshots;
  try {
    snapshots = await inspectPages(args.urls);
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Page inspection failed: ${err.message}` }] };
  }

  // One LLM call per URL in parallel — local LLM handles each independently,
  // falling back to Claude for any that fail.
  const results = await Promise.all(
    snapshots.map((snap) =>
      generateForSnapshot({
        path: snap.path,
        domText: formatSnapshots([snap]),
        nameHint: args.urls.length === 1 ? args.page_name : undefined,
        apiKey,
        localAvailable,
      }),
    ),
  );

  const written: string[] = [];
  const skipped: string[] = [];

  for (const result of results) {
    if (!result) { skipped.push('(generation failed)'); continue; }
    const { ok, reason } = await writeWithLocatorGuard(result.file, result.content);
    if (ok) written.push(result.file);
    else skipped.push(`${result.file} — ${reason}`);
  }

  const model = localAvailable ? LOCAL_MODEL : 'Claude API';
  const lines: string[] = written.length > 0
    ? [`✅ Generated locator-only POM${written.length > 1 ? 's' : ''} via ${model}:`, ...written.map(f => `  - ${f}`)]
    : ['⚠️  No files written.'];

  if (skipped.length > 0) {
    lines.push('', '⚠️  Skipped:', ...skipped.map(s => `  - ${s}`));
  }

  lines.push(
    '',
    'These files contain only locators — no methods.',
    'Run `generate_test` next; it will add methods using the correct locators already on disk.',
  );

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
