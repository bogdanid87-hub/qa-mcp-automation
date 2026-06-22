import { learnConventionsTool } from './tools/learn-conventions.js';

async function main(): Promise<void> {
  // Detection is read-only and token-free — no API key needed.
  const args: { output?: string } = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--output' && process.argv[i + 1]) args.output = process.argv[++i];
    if (process.argv[i] === '--help' || process.argv[i] === '-h') {
      console.log('\nUsage: npm run learn_conventions [-- --output <path>]\n\n' +
        'Detects this project\'s test conventions (POM hierarchy, fixtures, authoring idioms,\n' +
        'runner config) and writes workspace/PROJECT_CONVENTIONS.md. Read-only and token-free.\n');
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
