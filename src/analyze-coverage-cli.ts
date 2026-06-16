import { readFile } from 'fs/promises';
import { join } from 'path';
import { analyzeCoverageTool } from './tools/analyze-coverage.js';
import { SITE_URL } from './config.js';

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
      console.error(
        '\nUsage:\n' +
        '  npm run analyze_coverage -- --spec tests/ui/contact.spec.ts\n' +
        '  npm run analyze_coverage -- --spec tests/ui/\n' +
        `  npm run analyze_coverage -- --spec tests/api/ --url ${SITE_URL}\n` +
        `  npm run analyze_coverage -- --url ${SITE_URL}/<feature-page>\n` +
        '  npm run analyze_coverage -- --registry TESTS_UI.md --gaps\n' +
        '  npm run analyze_coverage                              # all registries\n' +
        '  npm run analyze_coverage -- --spec tests/ui/contact.spec.ts --deep  # two-pass (costs extra)\n' +
        '\nOptions:\n' +
        '  --spec <path>      Scope to a spec file or folder\n' +
        '  --registry <file>  Scope to a registry file (TESTS_UI.md / TESTS_API.md / TESTS_E2E.md)\n' +
        '  --url <url>        Add feature context (site page uses DOM extraction; docs page uses text)\n' +
        '  --gaps             Also write coverage-gaps.txt in prd-tests.txt format\n' +
        '  --deep             Run pre-analysis pass to identify untested paths (extra Claude call)\n',
      );
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
