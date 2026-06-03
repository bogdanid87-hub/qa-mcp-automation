import { readFile } from 'fs/promises';
import { join } from 'path';
import { generateAppKnowledgeTool } from './tools/generate-app-knowledge.js';

const ROOT = process.cwd();

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

function parseArgs(argv: string[]): { output?: string } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return { output: raw['output'] };
}

async function main(): Promise<void> {
  await ensureApiKey();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nError: ANTHROPIC_API_KEY is not set.\n');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  console.log('\n📚 Generating app knowledge base...\n');

  const result = await generateAppKnowledgeTool({ output: args.output });
  console.log(result.content[0]?.text ?? '');
  console.log('');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
