import { reviewRulesTool } from './tools/review-rules.js';

function parseArgs(argv: string[]): { promote?: string; help?: boolean } {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };

  const promoteIdx = argv.indexOf('--promote');
  const promote = promoteIdx !== -1 ? argv[promoteIdx + 1] : undefined;

  return { promote };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: npm run review_rules [-- --promote <NNN>]

Lists stale rules (referencing POM classes/methods that no longer exist) and
near-duplicate rule pairs across learned-rules.md and framework-rules.md — a
read-only hygiene report.

Options:
  --promote <NNN>  Move Rule <NNN> from learned-rules.md into framework-rules.md,
                   renumbering the remaining learned rules.

Example:
  npm run review_rules
  npm run review_rules -- --promote 15
`);
    process.exit(0);
  }

  const result = await reviewRulesTool({ promote: flags.promote });
  console.log(result.content[0]?.text ?? '(no output)');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
