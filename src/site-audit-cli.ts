import { siteAuditTool } from './tools/site-audit.js';
import { SITE_URL } from './config.js';

function parseArgs(argv: string[]): { url?: string; output?: string; maxPageTypes?: number; mode?: 'structure' | 'data' | 'all' } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  const mode = raw['mode'] as 'structure' | 'data' | 'all' | undefined;
  return {
    url:          raw['url'],
    output:       raw['output'],
    maxPageTypes: raw['max'] ? parseInt(raw['max'], 10) : undefined,
    mode:         ['structure', 'data', 'all'].includes(mode ?? '') ? mode : undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('\nUsage: npm run audit_site -- --url <url> [--mode all|structure|data] [--output report.md] [--max 30]\n');
    console.error('Modes:');
    console.error('  --mode all        site structure + test data constants (default)');
    console.error('  --mode structure  site-audit-report.json/.md only (POM hierarchy)');
    console.error('  --mode data       test-data/constants.ts only (products, users, search terms)\n');
    console.error('Examples:');
    console.error(`  npm run audit_site -- --url ${SITE_URL}`);
    console.error(`  npm run audit_site -- --url ${SITE_URL} --mode data\n`);
    process.exit(1);
  }

  try {
    const summary = await siteAuditTool({
      url:          args.url,
      output:       args.output,
      maxPageTypes: args.maxPageTypes,
      mode:         args.mode,
    });
    console.log(summary);
  } catch (err) {
    console.error('\nAudit failed:', (err as Error).message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
