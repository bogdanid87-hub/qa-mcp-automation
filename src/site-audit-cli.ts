import { siteAuditTool } from './tools/site-audit.js';

function parseArgs(argv: string[]): { url?: string; output?: string; maxPageTypes?: number } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return {
    url:          raw['url'],
    output:       raw['output'],
    maxPageTypes: raw['max'] ? parseInt(raw['max'], 10) : undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('\nUsage: npm run audit_site -- --url <site-url> [--output report.md] [--max 30]\n');
    console.error('Examples:');
    console.error('  npm run audit_site -- --url https://automationexercise.com');
    console.error('  npm run audit_site -- --url https://myapp.com --output docs/pom-audit.md\n');
    process.exit(1);
  }

  try {
    const summary = await siteAuditTool({
      url:          args.url,
      output:       args.output,
      maxPageTypes: args.maxPageTypes,
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
