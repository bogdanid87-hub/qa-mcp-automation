import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { runTests } from './tools/run-tests.js';
import {
  readBrokenTests,
  parsePassingTests,
  recordPassingTests,
  removeResolvedBrokenTests,
  normalizeTestName,
  registryForSpec,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
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

/** Extract test names that failed with "Expected to fail, but passed" (unexpected pass).
 *  Uses two patterns for resilience against minor Playwright output format changes. */
function detectUnexpectedPasses(output: string): string[] {
  const names: string[] = [];

  // Pattern 1: numbered failure block with error message (most reliable)
  const re1 = /\d+\)\s+\[chromium\]\s+›\s+[^\s:]+:\d+:\d+\s+›\s+([^›\n]+?)\s+›\s+(.+?)\n[\s\S]*?Error:\s+Expected to fail/gm;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(output)) !== null) names.push(m[2].trim());

  // Pattern 2: scan for the error phrase and extract the preceding test name line
  if (names.length === 0 && output.includes('Expected to fail')) {
    const re2 = /›\s+([^›\n]+)\s*\(\d+/gm;
    const errorLines = output.split('\n');
    for (let i = 0; i < errorLines.length; i++) {
      if (errorLines[i].includes('Expected to fail')) {
        // Look backward for the test title line (within 10 lines)
        for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
          const titleMatch = errorLines[j].match(/›\s+(.+?)\s+\(\d+/);
          if (titleMatch) { names.push(titleMatch[1].trim()); break; }
        }
      }
    }
  }

  return [...new Set(names)];
}

/** Strip test.fail() and the APP BUG annotation from a spec file for a given test name.
 *  Returns the stripped content + original for rollback, or null if not found. */
async function stripAppBugMarkers(absPath: string, testName: string): Promise<{ stripped: string; original: string } | null> {
  let src: string;
  try { src = await readFile(absPath, 'utf-8'); } catch { return null; }
  const original = src;

  const escaped = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Remove the /* ⚠️ APP BUG ... */ block comment before the test
  let stripped = src.replace(
    new RegExp(`\\/\\*[\\s\\S]*?APP BUG[\\s\\S]*?\\*\\/\\s*\\n([ \\t]*test\\s*\\(\\s*['"\`]${escaped}['"\`])`, 'm'),
    '$1',
  );

  // Remove test.fail() line inside the test body
  stripped = stripped.replace(
    /[ \t]*test\.fail\(\);[^\n]*\n/g,
    '',
  );

  if (stripped === src) return null; // nothing changed
  await writeFile(absPath, stripped, 'utf-8');
  return { stripped, original };
}

async function main(): Promise<void> {
  await ensureApiKey();

  const [broken, brokenApi, brokenE2e, brokenVisual] = await Promise.all([
    readBrokenTests(TESTS_UI_PATH),
    readBrokenTests(TESTS_API_PATH),
    readBrokenTests(TESTS_E2E_PATH),
    readBrokenTests(TESTS_VISUAL_PATH),
  ]);
  const allBroken = [...broken, ...brokenApi, ...brokenE2e, ...brokenVisual];

  if (allBroken.length === 0) {
    console.log('\n✅ No broken or app-bug tests recorded in any registry.\n');
    return;
  }

  const appBugCount = allBroken.filter(e => e.kind === 'app_bug').length;
  const brokenCount = allBroken.filter(e => e.kind === 'broken').length;
  console.log(`\n▶ Checking ${allBroken.length} recorded issue(s): ${appBugCount} app bug(s), ${brokenCount} broken test(s)\n`);

  // Group by spec to avoid running the same file more than once
  const bySpec = new Map<string, typeof allBroken>();
  for (const entry of allBroken) {
    if (!bySpec.has(entry.spec)) bySpec.set(entry.spec, []);
    bySpec.get(entry.spec)!.push(entry);
  }

  const resolvedKeys = new Set<string>();

  for (const [spec, entries] of bySpec) {
    console.log(`▶ Running ${spec}...`);
    const output = await runTests(spec);
    const passing = parsePassingTests(output);

    // Detect app-bug tests that now pass unexpectedly — this means the site
    // fixed the bug. test.fail() causes Playwright to report them as failures
    // ("Expected to fail, but passed") so they don't appear in parsePassingTests.
    // Detect the pattern and strip test.fail() + the APP BUG annotation,
    // then re-run to confirm the test passes cleanly.
    const unexpectedPasses = detectUnexpectedPasses(output);

    for (const testName of unexpectedPasses) {
      const entry = entries.find(e => e.kind === 'app_bug' &&
        (e.name === testName || normalizeTestName(e.name) === normalizeTestName(testName)));
      if (!entry) continue;

      console.log(`  🎉 App bug appears fixed (unexpected pass): ${entry.describe} › ${entry.name}`);
      console.log(`     Stripping test.fail() and APP BUG annotation, re-running to confirm...`);

      const absSpec = join(ROOT, spec);
      const stripped = await stripAppBugMarkers(absSpec, entry.name);
      if (!stripped) {
        console.log(`     ⚠️  Could not strip markers — clean up manually and re-run`);
        continue;
      }

      // Re-run without the markers to confirm the bug is genuinely fixed
      const confirmOutput = await runTests(spec);
      const confirmPassing = parsePassingTests(confirmOutput);
      const confirmNames = new Set(confirmPassing.map(p => {
        const sep = p.title.indexOf(' › ');
        return sep === -1 ? p.title : p.title.substring(sep + 3);
      }));

      if (confirmNames.has(entry.name) || [...confirmNames].some(n => normalizeTestName(n) === normalizeTestName(entry.name))) {
        resolvedKeys.add(`${entry.spec}::${entry.name}`);
        await recordPassingTests(confirmPassing);
        console.log(`     ✅ Confirmed fixed — promoted to passing. Remove the /* ⚠️ APP BUG */ comment manually.`);
      } else {
        // Confirmation failed — restore the markers
        const original = await readFile(absSpec, 'utf-8').catch(() => '');
        if (original) {
          // The test now fails without test.fail() — something else changed
          // Restore original state by re-writing with markers (already written by stripAppBugMarkers)
          console.log(`     ❌ Confirmation failed — markers restored, please investigate manually`);
          // Re-add test.fail() since we stripped it
          await writeFile(absSpec, stripped.original, 'utf-8');
        }
      }
    }

    // Move newly passing tests into the appropriate registry (non-app-bug entries)
    await recordPassingTests(passing);

    // Determine which broken/app-bug entries resolved via normal passing
    const passingNames = new Set(
      passing.map(p => {
        const sep = p.title.indexOf(' › ');
        return sep === -1 ? p.title : p.title.substring(sep + 3);
      })
    );
    const passingNamesNorm = new Set([...passingNames].map(normalizeTestName));

    for (const entry of entries) {
      const key = `${entry.spec}::${entry.name}`;
      if (resolvedKeys.has(key)) continue; // already handled above
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
    // Route removals to the correct registry per spec path
    const resolvedByRegistry = new Map<string, Set<string>>();
    for (const key of resolvedKeys) {
      const spec = key.split('::')[0];
      const reg = registryForSpec(spec);
      if (!resolvedByRegistry.has(reg)) resolvedByRegistry.set(reg, new Set());
      resolvedByRegistry.get(reg)!.add(key);
    }
    for (const [reg, keys] of resolvedByRegistry) await removeResolvedBrokenTests(keys, reg);
    console.log(`✅ Moved ${resolvedKeys.size} resolved test(s) to the passing section.`);
    console.log('   Reminder: remove any remaining /* ⚠️ BROKEN */ or /* ⚠️ APP BUG */ comments manually.\n');
  } else {
    console.log('No tests resolved — registries unchanged.\n');
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
