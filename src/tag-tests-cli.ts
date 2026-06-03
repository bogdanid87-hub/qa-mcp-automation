import {
  readTestCases,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
  type TestEntry,
} from './tools/test-registry.js';
import { tagSpec } from './tools/tag-tests.js';

const REGISTRIES: Array<{ path: string; prefix: string }> = [
  { path: TESTS_UI_PATH,     prefix: 'UI'     },
  { path: TESTS_API_PATH,    prefix: 'API'    },
  { path: TESTS_E2E_PATH,    prefix: 'E2E'    },
  { path: TESTS_VISUAL_PATH, prefix: 'Visual' },
];

async function main(): Promise<void> {
  console.log('\n🏷️  Tagging tests with registry IDs...\n');

  let totalTagged = 0, totalUpdated = 0, totalCorrect = 0;
  const warnings: string[] = [];

  for (const { path, prefix } of REGISTRIES) {
    const entries = await readTestCases(path);
    if (entries.length === 0) continue;

    // Group by spec file
    const bySpec = new Map<string, TestEntry[]>();
    for (const entry of entries) {
      if (!bySpec.has(entry.spec)) bySpec.set(entry.spec, []);
      bySpec.get(entry.spec)!.push(entry);
    }

    for (const [spec, specEntries] of bySpec) {
      const { tagged, updated, correct, notFound } = await tagSpec(spec, specEntries, prefix);

      // Missing spec file: all entries returned as notFound with no src read
      if (notFound.length === specEntries.length && tagged === 0 && updated === 0 && correct === 0) {
        warnings.push(`  ⚠️  [${prefix}] ${spec} — file not found on disk (remove its entries from the registry manually; sync_registry will warn but not delete them)`);
        continue;
      }

      totalTagged  += tagged;
      totalUpdated += updated;
      totalCorrect += correct;

      if (tagged > 0 || updated > 0) {
        const parts = [
          tagged  > 0 ? `+${tagged} added`   : '',
          updated > 0 ? `~${updated} updated` : '',
        ].filter(Boolean).join(', ');
        console.log(`  [${prefix}] ${spec} — ${parts}`);
      }

      for (const name of notFound) {
        warnings.push(`  ⚠️  [${prefix}] ${spec} — test name not found in file: "${name}" (if renamed: update the registry row; if deleted: remove it — sync_registry will not fix this)`);
      }
    }
  }

  if (warnings.length > 0) {
    console.log('\n' + warnings.join('\n'));
  }

  if (totalTagged === 0 && totalUpdated === 0) {
    console.log('\n  All tests already tagged — nothing to do.\n');
    return;
  }

  const eq = '═'.repeat(48);
  console.log(`\n${eq}`);
  console.log(`  Done: ${totalTagged} added, ${totalUpdated} updated, ${totalCorrect} already correct`);
  if (warnings.length > 0) console.log(`  ${warnings.length} warning${warnings.length === 1 ? '' : 's'} — see above`);
  console.log(`${eq}\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
