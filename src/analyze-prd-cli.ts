import { readFile } from 'fs/promises';
import { join } from 'path';
import { analyzePrdTool } from './tools/analyze-prd.js';

const ROOT = process.cwd();

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

async function main(): Promise<void> {
  await ensureApiKey();

  const raw: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--') && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
      raw[process.argv[i].slice(2)] = process.argv[++i];
    }
  }

  const filePath = raw['file'];
  if (!filePath) {
    console.error(
      '\nUsage:\n' +
      '  npm run analyze-prd -- --file prd.md\n' +
      '  npm run analyze-prd -- --file prd.md --output prd-tests.txt\n',
    );
    process.exit(1);
  }

  let prdContent: string;
  try {
    prdContent = await readFile(filePath, 'utf-8');
  } catch (err: any) {
    console.error(`\nCould not read ${filePath}: ${err.message}\n`);
    process.exit(1);
  }

  console.log('\n⏳ Analysing PRD and generating test suggestions...\n');

  const result = await analyzePrdTool({
    prdContent,
    outputFile: raw['output'] ? join(ROOT, raw['output']) : undefined,
  });

  console.log(result.content[0]?.text ?? '');
  console.log('');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
