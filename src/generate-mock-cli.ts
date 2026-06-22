import { readFile } from 'fs/promises';
import { join } from 'path';
import { generateMockTool, type GenerateMockArgs } from './tools/generate-mock.js';
import { cliHelp } from './lib/cli-help.js';

const ROOT = process.cwd();

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

function parseArgs(argv: string[]): Partial<GenerateMockArgs> & { help?: boolean } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return {
    name:         raw['name'],
    urlPattern:   raw['url'] ?? raw['pattern'],
    method:       raw['method'] as GenerateMockArgs['method'],
    status:       raw['status'] ? parseInt(raw['status'], 10) : undefined,
    responseBody: raw['response'] ?? raw['body'],
    scope:        raw['scope'] as 'fixture' | 'inline' | undefined,
    notes:        raw['notes'],
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
    console.log('\n' + cliHelp('generate_mock'));
    process.exit(0);
  }

  if (!flags.name)         { console.error('Error: --name is required.'); process.exit(1); }
  if (!flags.urlPattern)   { console.error('Error: --url is required.'); process.exit(1); }
  if (!flags.responseBody) { console.error('Error: --response is required.'); process.exit(1); }

  const args: GenerateMockArgs = {
    name:         flags.name!,
    urlPattern:   flags.urlPattern!,
    method:       flags.method,
    status:       flags.status,
    responseBody: flags.responseBody!,
    scope:        flags.scope ?? 'fixture',
    notes:        flags.notes,
  };

  console.log('\n⏳ Generating mock...\n');
  const result = await generateMockTool(args);
  console.log(result.content[0]?.text ?? '(no output)');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
