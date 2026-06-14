import { initProjectTool, type InitProjectArgs } from './tools/init-project.js';

function parseArgs(argv: string[]): Partial<InitProjectArgs> & { help?: boolean } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return {
    projectName: raw['name'],
    siteUrl:     raw['url'],
    profile:     raw['profile'] as InitProjectArgs['profile'],
    outputPath:  raw['output'],
    force:       'force' in raw || argv.includes('--force'),
  };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: npm run init_project -- --name <name> --url <site-url> [options]

Bootstraps mcp-qa.config.json plus a minimal pages/fixtures/tests scaffold for
a new project. Writes no files outside the config's directory, runs no
audit/LLM calls.

Options:
  --name <name>        Project name, e.g. "my-shop"
  --url <site-url>     Base URL of the site to test, e.g. "https://example.com"
  --profile <profile>  Risk-tier keyword profile: "generic" (default) or "ecommerce"
  --output <path>      Where to write the config (default: ./mcp-qa.config.json)
  --force               Overwrite an existing mcp-qa.config.json

Example:
  npm run init_project -- --name my-shop --url https://example.com --profile ecommerce
`);
    process.exit(0);
  }

  if (!flags.projectName) { console.error('Error: --name is required.'); process.exit(1); }
  if (!flags.siteUrl)     { console.error('Error: --url is required.'); process.exit(1); }

  const args: InitProjectArgs = {
    projectName: flags.projectName,
    siteUrl:     flags.siteUrl,
    profile:     flags.profile,
    outputPath:  flags.outputPath,
    force:       flags.force,
  };

  const result = await initProjectTool(args);
  console.log(result.content[0]?.text ?? '(no output)');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
