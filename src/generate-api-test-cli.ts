import { readFile } from 'fs/promises';
import { join } from 'path';
import { generateTestTool } from './tools/generate-test.js';

const ROOT = process.cwd();

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

/**
 * Parse metadata from a description file — same directives as my-test.txt:
 *   # test_name: products-list
 *   # spec_file: tests/api/products.spec.ts
 */
function parseMetadata(raw: string): {
  description: string;
  testName?: string;
  specFile?: string;
} {
  const lines = raw.split('\n');
  let testName: string | undefined;
  let specFile: string | undefined;
  const descLines: string[] = [];

  for (const line of lines) {
    const meta = line.match(/^#\s*(test_name|spec_file)\s*:\s*(.+)/i);
    if (meta) {
      const [, key, value] = meta;
      if (key.toLowerCase() === 'test_name') testName = value.trim();
      if (key.toLowerCase() === 'spec_file') specFile = value.trim();
    } else if (line.startsWith('#')) {
      // skip comment lines
    } else {
      descLines.push(line);
    }
  }

  return { description: descLines.join('\n').trim(), testName, specFile };
}

async function main(): Promise<void> {
  await ensureApiKey();

  const raw: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--') && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
      raw[process.argv[i].slice(2)] = process.argv[++i];
    }
  }

  let description = raw['description'];
  let testName = raw['test_name'];
  let specFile = raw['spec_file'];

  if (!description && raw['file']) {
    try {
      const content = await readFile(raw['file'], 'utf-8');
      const meta = parseMetadata(content);
      description = meta.description;
      if (!testName && meta.testName) testName = meta.testName;
      if (!specFile && meta.specFile) specFile = meta.specFile;
    } catch (err: any) {
      console.error(`\nCould not read ${raw['file']}: ${err.message}\n`);
      process.exit(1);
    }
  }

  if (!description) {
    console.error(
      '\nUsage:\n' +
      '  npm run generate_api -- --description "Test GET /api/productsList"\n' +
      '  npm run generate_api -- --file my-api-test.txt\n' +
      '  npm run generate_api -- --description "..." --spec_file tests/api/products.spec.ts\n' +
      '  npm run generate_api -- --description "..." --test_name products-list\n' +
      '\nFile format (same as my-test.txt):\n' +
      '  # test_name: products-list\n' +
      '  # spec_file: tests/api/products.spec.ts\n' +
      '  Test the GET /api/productsList endpoint...\n',
    );
    process.exit(1);
  }

  console.log('\n⏳ Generating API test...\n');

  // Route through the unified generate_test tool with type forced to 'api'
  const result = await generateTestTool({ description, test_name: testName, spec_file: specFile, type: 'api' });
  console.log(result.content[0]?.text ?? '');
  console.log('');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
