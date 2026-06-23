import { learnConventionsTool } from './tools/learn-conventions.js';

async function main(): Promise<void> {
  // Detection is read-only and token-free — no API key needed.
  const args: { output?: string; applyPom?: boolean; applyConventions?: boolean; write?: boolean } = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--output' && process.argv[i + 1]) args.output = process.argv[++i];
    else if (a === '--apply-pom') args.applyPom = true;
    else if (a === '--apply-conventions') args.applyConventions = true;
    else if (a === '--write') args.write = true;
    else if (a === '--help' || a === '-h') {
      console.log('\nUsage: npm run learn_conventions [-- options]\n\n' +
        'Detects this project\'s test conventions (POM hierarchy, fixtures, authoring idioms,\n' +
        'runner config) and writes workspace/PROJECT_CONVENTIONS.md. Read-only and token-free.\n\n' +
        'Options:\n' +
        '  --output <path>        Where to write the report (default: workspace/PROJECT_CONVENTIONS.md)\n' +
        '  --apply-pom            Preview writing the detected hierarchy into mcp-qa.config.json (dry run)\n' +
        '  --apply-conventions    Preview writing the conventions block into config.prompts.conventions\n' +
        '  --write                With an --apply-* flag, actually write the config changes\n');
      process.exit(0);
    }
  }

  console.log('\n⏳ Detecting project conventions...\n');
  const result = await learnConventionsTool(args);
  console.log(result.content[0]?.text ?? '');
  console.log('');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
