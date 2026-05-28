import { readFile } from 'fs/promises';
import { join } from 'path';
import { runTests } from './tools/run-tests.js';
import {
  readBrokenTests,
  parsePassingTests,
  recordPassingTests,
  removeResolvedBrokenTests,
  normalizeTestName,
} from './tools/test-registry.js';

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

  const broken = await readBrokenTests();

  if (broken.length === 0) {
    console.log('\n✅ No broken or app-bug tests recorded in TEST_CASES.md.\n');
    return;
  }

  const appBugCount = broken.filter(e => e.kind === 'app_bug').length;
  const brokenCount = broken.filter(e => e.kind === 'broken').length;
  console.log(`\n▶ Checking ${broken.length} recorded issue(s): ${appBugCount} app bug(s), ${brokenCount} broken test(s)\n`);

  // Group by spec to avoid running the same file more than once
  const bySpec = new Map<string, typeof broken>();
  for (const entry of broken) {
    if (!bySpec.has(entry.spec)) bySpec.set(entry.spec, []);
    bySpec.get(entry.spec)!.push(entry);
  }

  const resolvedKeys = new Set<string>();

  for (const [spec, entries] of bySpec) {
    console.log(`▶ Running ${spec}...`);
    const output = await runTests(spec);
    const passing = parsePassingTests(output);

    // Move newly passing tests into the passing section
    await recordPassingTests(passing);

    // Determine which broken entries resolved
    const passingNames = new Set(
      passing.map(p => {
        const sep = p.title.indexOf(' › ');
        return sep === -1 ? p.title : p.title.substring(sep + 3);
      })
    );
    const passingNamesNorm = new Set([...passingNames].map(normalizeTestName));

    for (const entry of entries) {
      const key = `${entry.spec}::${entry.name}`;
      if (passingNames.has(entry.name) || passingNamesNorm.has(normalizeTestName(entry.name))) {
        resolvedKeys.add(key);
        const label = entry.kind === 'app_bug' ? '⚠️  App bug resolved' : '❌ Broken test resolved';
        console.log(`  ✅ ${label}: ${entry.describe} › ${entry.name}`);
      } else {
        const label = entry.kind === 'app_bug' ? '⚠️  Still an app bug' : '❌ Still broken';
        console.log(`  ${label}: ${entry.describe} › ${entry.name}`);
      }
    }
    console.log('');
  }

  if (resolvedKeys.size > 0) {
    await removeResolvedBrokenTests(resolvedKeys);
    console.log(`✅ Moved ${resolvedKeys.size} resolved test(s) to the passing section in TEST_CASES.md.`);
    console.log('   ⚠️  BROKEN / ⚠️  APP BUG comments in spec files were not removed — clean those up manually.\n');
  } else {
    console.log('No tests resolved — TEST_CASES.md unchanged.\n');
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
