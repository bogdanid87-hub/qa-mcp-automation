import { generatePomTool } from './tools/generate-pom.js';

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.error('Usage: npx tsx src/generate-pom-cli.ts /page-path [/another-path]');
    process.exit(1);
  }

  const result = await generatePomTool({ urls });
  console.log(result.content[0].text);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
