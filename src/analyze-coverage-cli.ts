import { readFile } from 'fs/promises';
import { join } from 'path';
import { analyzeCoverageTool } from './tools/analyze-coverage.js';
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

async function main(): Promise<void> {
  await ensureApiKey();

  const raw: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 2; i < process.argv.length; i++) {
    if (!process.argv[i].startsWith('--')) continue;
    const key = process.argv[i].slice(2);
    if (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
      raw[key] = process.argv[++i];
    } else {
      flags.add(key);
    }
  }

  if (!raw['spec'] && !raw['registry'] && !raw['url'] && !flags.has('gaps')) {
    if (process.argv.length <= 2) {
      // No args — show usage
      console.error('\n' + cliHelp('analyze_coverage'));
      process.exit(1);
    }
  }

  const scopeLabel = raw['spec']
    ? raw['spec']
    : raw['registry']
    ? raw['registry']
    : 'all registries';

  const urlLabel = raw['url'] ? ` + ${raw['url']}` : '';
  console.log(`\n⏳ Analysing coverage (${scopeLabel}${urlLabel})...\n`);

  const result = await analyzeCoverageTool({
    specPath: raw['spec'],
    registryPath: raw['registry'],
    url: raw['url'],
    generateGaps: flags.has('gaps'),
    deep: flags.has('deep'),
  });

  console.log(result.content[0]?.text ?? '');
  console.log('');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
